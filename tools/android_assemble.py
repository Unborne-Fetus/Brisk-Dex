#!/usr/bin/env python3
"""Assemble upstream native data/song output as AArch64 ELF, not x86-64.

The upstream preproc + asm_filter pipeline has already converted pointer
tables to native 8-byte layouts and stripped ARM '@' comments. Supply the
same GBA macro definitions as the original Makefile.native while keeping
the Android-specific marker for safe script command tags.
"""
import argparse
import subprocess
import sys
import struct
import tempfile
from pathlib import Path
from collections import defaultdict

HEADER = b"""\t.set MODERN,1
\t.set EMERALD,1
\t.set PLATFORM_NATIVE,1
\t.set NATIVE_POINTER_SIZE_8,1
\t.set BRISK_ANDROID_ASM,1
"""




def relocate_assembly_data(obj, objcopy):
    """Make song jump words PC-relative and place relocatable data in RELRO.

    Do not widen packed 4-byte music instructions or permit text relocations.
    Only song-local ABS32 addresses have the matching runtime decoder.
    """
    data = bytearray(obj.read_bytes())
    if data[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", data, 18)[0] != 183:
        raise ValueError(f"Expected little-endian AArch64 ELF object: {obj}")
    shoff = struct.unpack_from("<Q", data, 40)[0]
    entsize, count, names_index = struct.unpack_from("<HHH", data, 58)
    sections = [struct.unpack_from("<IIQQQQIIQQ", data, shoff + i * entsize)
                for i in range(count)]
    names = sections[names_index]
    def name(section):
        start = names[4] + section[0]
        return data[start:data.index(0, start)].decode()
    rename = set()
    changed = 0
    is_song = "songs" in obj.parts and "sound" in obj.parts
    for rel in sections:
        if rel[1] != 4:  # SHT_RELA
            continue
        target = sections[rel[7]]
        symtab = sections[rel[6]]
        for offset in range(rel[4], rel[4] + rel[5], rel[9]):
            _, info, _ = struct.unpack_from("<QQq", data, offset)
            kind, sym = info & 0xffffffff, info >> 32
            symoff = symtab[4] + sym * symtab[9]
            binding, _, shndx = struct.unpack_from("<BBH", data, symoff + 4)
            if kind == 258 and is_song and binding >> 4 == 0 and 0 < shndx < count:
                # R_AARCH64_ABS32 -> R_AARCH64_PREL32, S+A-P.
                struct.pack_into("<Q", data, offset + 8, (sym << 32) | 261)
                changed += 1
            if kind == 257 and target[2] & 2 and not target[2] & 1:
                section_name = name(target)
                if not section_name.startswith(".rodata") or target[2] & 4:
                    raise ValueError(f"Unexpected read-only ABS64 target {obj}:{section_name}")
                rename.add(section_name)
    if changed:
        obj.write_bytes(data)
    if rename:
        command = [objcopy]
        for section in sorted(rename):
            command += ["--rename-section", section + "=.data.rel.ro" +
                        section[len(".rodata"):] + ",alloc,load,data,contents"]
        subprocess.run(command + [str(obj)], check=True)
    return changed, len(rename)


def normalize_absolute_constants(argv):
    """Keep one global definition of each repeated, equal assembler constant.

    Expansion's preproc deliberately exports enum values with .global/.equiv
    for references from other assembly units. ELF lld rejects multiple strong
    absolute definitions even when the values agree. Localize only redundant
    absolute definitions, never code/data labels or conflicting constants.
    """
    parser = argparse.ArgumentParser(description=normalize_absolute_constants.__doc__)
    parser.add_argument("--nm", required=True)
    parser.add_argument("--objcopy", required=True)
    parser.add_argument("objects", nargs="+", type=Path)
    args = parser.parse_args(argv)
    definitions = defaultdict(list)
    for obj in dict.fromkeys(args.objects):
        report = subprocess.check_output(
            [args.nm, "--defined-only", "--format=posix", str(obj)], text=True)
        for line in report.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[1] == "A":
                definitions[parts[0]].append((obj, int(parts[2], 16)))
    changes = defaultdict(list)
    for symbol, entries in definitions.items():
        if len(entries) < 2:
            continue
        if len({value for _, value in entries}) != 1:
            raise SystemExit(f"Conflicting absolute constant {symbol}: {entries}")
        for obj, _ in entries[1:]:
            changes[obj].append(symbol)
    with tempfile.TemporaryDirectory(prefix="brisk-abs-") as directory:
        names = Path(directory) / "symbols.txt"
        for obj, symbols in changes.items():
            names.write_text("\n".join(sorted(symbols)) + "\n")
            subprocess.run([args.objcopy, "--localize-symbols=" + str(names), str(obj)],
                           check=True)
    relative = relro = 0
    for obj in dict.fromkeys(args.objects):
        a, b = relocate_assembly_data(obj, args.objcopy)
        relative += a
        relro += b
    print(f"Converted {relative} packed song jumps to relative offsets; "
          f"moved {relro} pointer-bearing read-only sections to RELRO.")
    print(f"Localized {sum(map(len, changes.values()))} redundant absolute constants "
          f"across {len(changes)} assembly objects; retained one global definition per constant.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--compiler", required=True)
    # Brisk's event-script macros use GNU as absolute-expression semantics.
    # Clang's integrated assembler does not support those macro comparisons.
    parser.add_argument("--assembler", default="aarch64-linux-gnu-as")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("-I", dest="include", action="append", default=[])
    args, unknown = parser.parse_known_args()
    bad = [x for x in unknown if not x.startswith("--defsym") and x not in ("--64", "--noexecstack", "-fPIC")]
    if bad:
        parser.error("Unsupported assembler argument: " + repr(bad))
    import shutil
    if not shutil.which(args.assembler):
        parser.error("GNU AArch64 assembler required for Brisk script macros: install binutils-aarch64-linux-gnu, or provide --assembler PATH")
    command = [args.assembler, "-o", args.output]
    for directory in args.include:
        command.extend(["-I", directory])
    command.append("-")
    result = subprocess.run(command, input=HEADER + sys.stdin.buffer.read(), capture_output=True)
    sys.stderr.buffer.write(result.stderr)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--normalize-absolute-constants":
        normalize_absolute_constants(sys.argv[2:])
    else:
        main()
