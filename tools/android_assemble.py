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
import tempfile
from pathlib import Path
from collections import defaultdict

HEADER = b"""\t.set MODERN,1
\t.set EMERALD,1
\t.set PLATFORM_NATIVE,1
\t.set NATIVE_POINTER_SIZE_8,1
\t.set BRISK_ANDROID_ASM,1
"""



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
