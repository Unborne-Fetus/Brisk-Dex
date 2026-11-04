#!/usr/bin/env python3
"""Attempt ARM64 compilation of every pinned native platform C module.

This is diagnostic, not a full game build. Only object compilation is checked:
linking the game's data/code, its address model, SDL2, and save migration are
separate work. Failed objects do NOT become a fake libbriskgame.so.
"""
import argparse
import json
import subprocess
from pathlib import Path

SKIP = frozenset((
    "host_linux.c", "host_linked.c", "arm_division.c",
    "host_windows.c", "host_windows_console.c", "host_windows_fault.c",
    "host_windows_stack.c", "host_windows_thread.c",
))

def probe(source, compiler, directory, sdl_include=None):
    platform=source/"platform"
    if not (platform/"gba_memmap.c").is_file():
        raise RuntimeError("Pass the fully prepared pinned Brisk source checkout")
    directory.mkdir(parents=True,exist_ok=True)
    common=[
        str(compiler),"-std=gnu17","-fPIC","-funsigned-char",
        "-DMODERN=1","-DEMERALD","-DPLATFORM_NATIVE=1",
        "-DBRISK_NATIVE=1","-DBRISK_ANDROID=1",
        "-I"+str(platform),"-iquote",str(source),
        "-idirafter",str(source/"include")
    ]
    if sdl_include is not None:
        if not (sdl_include/"SDL.h").is_file():
            raise RuntimeError("SDL2 header directory missing")
        common.append("-I"+str(sdl_include))
    passed=[];failed={};skipped=[]
    for file in sorted(platform.glob("*.c")):
        if file.name in SKIP:
            skipped.append(file.name)
            continue
        result=subprocess.run(
            common+["-c",str(file),"-o",str(directory/(file.stem+".o"))],
            text=True,capture_output=True,timeout=45)
        if result.returncode:
            failed[file.name]=result.stderr[:1800] or "Compiler failed without stderr"
        else:
            passed.append(file.name)
    return {
        "target":"Android ARM64 object compilation",
        "compiler":str(compiler),
        "native_game_built":False,
        "full_game_linked":False,
        "platform_objects_passed":len(passed),
        "platform_objects_failed":len(failed),
        "platform_objects_skipped":len(skipped),
        "passed":passed,"failed":failed,"skipped":skipped
    }

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--compiler",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--sdl-include",type=Path)
    args=parser.parse_args()
    data=probe(args.source.resolve(),args.compiler,args.output.parent/"arm64-objects",
               args.sdl_include.resolve() if args.sdl_include else None)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(data,indent=2)+"\n")
    print("Android ARM64 native platform source: "
          f"{data['platform_objects_passed']} compiled, "
          f"{data['platform_objects_failed']} failed, "
          f"{data['platform_objects_skipped']} skipped")
    for name,diagnostic in data["failed"].items():
        relevant=[line.strip() for line in diagnostic.splitlines() if "error:" in line]
        print(f"  {name}: {(relevant[0] if relevant else diagnostic.splitlines()[0] if diagnostic else 'unknown error')[:220]}")
    print("Report:",args.output)
    if not data["platform_objects_passed"]:
        parser.exit(1,"No Android native platform modules compiled\n")

if __name__=="__main__":
    main()
