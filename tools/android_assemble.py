#!/usr/bin/env python3
"""Assemble upstream native data/song output as AArch64 ELF, not x86-64.

The upstream preproc + asm_filter pipeline has already converted pointer
tables to native 8-byte layouts and stripped ARM '@' comments. Supply the
same GBA macro definitions as the original Makefile.native while keeping
the Android-specific marker for safe script command tags.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

HEADER = b"""\t.set MODERN,1
\t.set EMERALD,1
\t.set PLATFORM_NATIVE,1
\t.set NATIVE_POINTER_SIZE_8,1
\t.set BRISK_ANDROID_ASM,1
"""


def localize_assembler_constants(output, nm, objcopy):
    """Keep each source file's GBA enum .set aliases private.

    GNU AArch64 as exports the generated uppercase absolute constants in some
    Brisk data objects. Whole-archive PIE links then reject thousands of
    duplicate MALE, DIR_NONE, etc symbols. These are compile-time enum values,
    not game data or externally callable functions; localize only absolute
    uppercase aliases, leaving all real exported sections and functions alone.
    """
    report = subprocess.run(
        [nm, "-g", "--defined-only", "-P", output], capture_output=True, text=True
    )
    if report.returncode:
        sys.stderr.write(report.stderr)
        return report.returncode
    names = {
        parts[0]
        for line in report.stdout.splitlines()
        if (parts := line.split()) and len(parts) >= 2
        and parts[1] == "A" and re.fullmatch(r"[A-Z][A-Z0-9_]*", parts[0])
    }
    if not names:
        return 0
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="ascii", delete=False) as listing:
            listing.write("\n".join(sorted(names)) + "\n")
            temporary = listing.name
        fixed = subprocess.run(
            [objcopy, "--localize-symbols=" + temporary, output],
            capture_output=True,
        )
        sys.stderr.buffer.write(fixed.stderr)
        return fixed.returncode
    finally:
        if temporary is not None:
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--compiler", required=True)
    # Brisk's event-script macros use GNU as absolute-expression semantics.
    # Clang's integrated assembler does not support those macro comparisons.
    parser.add_argument("--assembler", default="aarch64-linux-gnu-as")
    parser.add_argument("--nm", default="aarch64-linux-gnu-nm")
    parser.add_argument("--objcopy", default="aarch64-linux-gnu-objcopy")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("-I", dest="include", action="append", default=[])
    args, unknown = parser.parse_known_args()
    bad = [x for x in unknown if not x.startswith("--defsym") and x not in ("--64", "--noexecstack", "-fPIC")]
    if bad:
        parser.error("Unsupported assembler argument: " + repr(bad))
    for executable in (args.assembler, args.nm, args.objcopy):
        if not shutil.which(executable):
            parser.error("GNU AArch64 assembler, nm and objcopy required: missing " + executable)
    command = [args.assembler, "-o", args.output]
    for directory in args.include:
        command.extend(["-I", directory])
    command.append("-")
    result = subprocess.run(command, input=HEADER + sys.stdin.buffer.read(), capture_output=True)
    sys.stderr.buffer.write(result.stderr)
    if result.returncode:
        raise SystemExit(result.returncode)
    raise SystemExit(localize_assembler_constants(args.output, args.nm, args.objcopy))


if __name__ == "__main__":
    main()
