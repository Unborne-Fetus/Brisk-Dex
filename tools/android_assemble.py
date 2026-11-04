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

HEADER = b"""\t.set MODERN,1
\t.set EMERALD,1
\t.set PLATFORM_NATIVE,1
\t.set NATIVE_POINTER_SIZE_8,1
\t.set BRISK_ANDROID_ASM,1
"""


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
    main()
