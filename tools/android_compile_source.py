#!/usr/bin/env python3
"""Compile a real native-preprocessed Pokémon C module for Android ARM64.

Makefile.android passes an intermediate .i created by upstream's native
cpp -> preproc -> c_filter pipeline. Every signed/unsigned integer division
in the generated LLVM IR is replaced with GBA APCS-gnu libgcc semantics.
This MUST be applied to every gameplay module or the Android port will
silently differ from the original game for division by zero.
"""
import argparse
import subprocess
import sys
from pathlib import Path
from rewrite_android_division_ir import transform


def run(args, data=None):
    outcome = subprocess.run(args, input=data, capture_output=True)
    if outcome.returncode:
        sys.stderr.buffer.write(outcome.stderr)
        raise RuntimeError("Android game C build failed: " + " ".join(map(str, args[:7])))
    return outcome.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--platform", action="store_true", help="Compile an original platform C source through the same GBA division IR transform")
    parser.add_argument("--sdl-include", type=Path, help="SDL2 include directory for platform files")
    parser.add_argument("--rename-main", action="store_true", help="Rename the actual native main as the JNI-accessible entry point")
    args = parser.parse_args()
    src = args.source.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    compiler_args = [args.compiler, "-std=gnu17", "-fPIC", "-funsigned-char",
                     "-O0", "-Xclang", "-disable-O0-optnone", "-S", "-emit-llvm"]
    if args.platform:
        if args.sdl_include is None:
            parser.error("Platform sources require --sdl-include")
        compiler_args += [
            "-D_GNU_SOURCE", "-DMODERN=1", "-DEMERALD=1",
            "-DPLATFORM_NATIVE=1", "-DBRISK_NATIVE=1", "-DBRISK_ANDROID=1",
            "-Iplatform", "-I" + str(args.sdl_include), "-iquote", ".",
            "-idirafter", "include",
        ]
        if args.rename_main:
            compiler_args.append("-Dmain=brisk_android_game_main")
    elif args.rename_main:
        parser.error("--rename-main is only valid with --platform")
    llvm = run(compiler_args + ["-x", "c", str(src), "-o", "-"]).decode("utf-8")
    processed, report = transform(llvm)
    run([args.compiler, "-fPIC", "-O2", "-c", "-x", "ir", "-o",
         str(args.output.resolve()), "-"], processed.encode("utf-8"))
    print(f"ARM64 game {args.output}: {report['rewritten']} GBA divisions", flush=True)


if __name__ == "__main__":
    main()
