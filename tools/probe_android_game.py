#!/usr/bin/env python3
"""Cross-compile representative Brisk game C translation units for Android.

This is an actual NDK compiler probe of the pinned, merged game sources,
not a substitute for linking or running the game. Assets and map constants
must be generated before invoking it. Reports exact failures for porting.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import shutil
from pathlib import Path
from rewrite_android_division_ir import transform as transform_division_ir

PRIORITY_MODULES = (
    "main.c", "pokemon.c", "battle_main.c", "battle_setup.c",
    "battle_util.c", "battle_script_commands.c", "battle_ai_util.c",
    "save.c", "overworld.c", "script.c", "field_control_avatar.c",
    "pokedex.c", "wild_encounter.c", "item_use.c", "field_effect.c",
    "battle_controller_player.c", "battle_controller_opponent.c",
    "pokemon_storage_system.c", "evolution_scene.c",
)

MISSING_ASSET = re.compile(r'Failed to open "([^"]+)" for reading')
LAST_ASSET_FAILURE = ""

def asset_result(command, result, output):
    """Capture the real underlying converter error for reproducible CI diagnostics."""
    global LAST_ASSET_FAILURE
    if result.returncode == 0 and output.is_file():
        return True
    LAST_ASSET_FAILURE = (
        f"command: {command!r}; exit: {result.returncode}; "
        f"stderr: {result.stderr.decode('utf-8', 'replace')[-1000:]}; "
        f"stdout: {result.stdout.decode('utf-8', 'replace')[-300:]}"
    )
    return False


def generate_native_graphic(source: Path, requested: str, depth: int = 0) -> bool:
    """Convert only a missing INCGFX dependency into build/assets-native.

    Uses the game's own gbagfx conversion and palette-padding tool, not a
    substitute image. The input must exist beneath the checked-out source.
    """
    if depth > 4:
        return False
    root = Path("build/assets-native")
    relative = Path(requested)
    if relative.is_absolute() or ".." in relative.parts or not relative.is_relative_to(root):
        return False
    target = source / relative
    if target.is_file():
        return True
    native_base = Path(*relative.parts[2:])
    # The expansion preprocessor encodes INCGFX conversion options in the
    # intermediate filename. Decode only a reviewed allowlist of real
    # gbagfx options; never invent pixel data or guess an unknown option.
    custom = re.fullmatch(
        r"(.+\.(?:png|pal))_(.+)(\.(?:4bpp|8bpp|1bpp|gbapal))",
        native_base.as_posix(),
    )
    if custom:
        option_strings = custom.group(2).split("__")
        allowed_values = ("num_tiles", "mwidth", "mheight", "num_colors")
        allowed_flags = ("Wnum_tiles", "Wnum_colors")
        flags = []
        for option in option_strings:
            if option in allowed_flags:
                flags.append("-" + option)
                continue
            parsed = next(
                ((item, option[len(item) + 1:])
                 for item in allowed_values if option.startswith(item + "_")),
                None,
            )
            if parsed is None or not parsed[1].isdigit():
                return False
            flags += ["-" + parsed[0], parsed[1]]
        original = source / custom.group(1)
        if not original.is_file():
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "sh", str(source / "platform/build_glue/gbagfx_pad.sh"),
            custom.group(1), requested, *flags,
        ]
        result = subprocess.run(
            cmd, cwd=source, capture_output=True, timeout=30,
            env=dict(os.environ, PAD_UNDER="build/assets-native"),
        )
        return asset_result(cmd, result, target)
    # Composite tilesheets are assembled by the native project's own
    # graphics_file_rules.mk; copying the rule's output retains exact
    # wallpaper frame tile counts and ordering.
    if (native_base.suffix == ".4bpp"
            and "/wallpapers/" in native_base.as_posix()
            and native_base.name == "tiles.4bpp"):
        built = subprocess.run(
            ["make", "-f", "Makefile.native", "SETUP_PREREQS=0",
             "NODEP=1", native_base.as_posix()],
            cwd=source, capture_output=True, timeout=90,
        )
        original = source / native_base
        if built.returncode == 0 and original.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            return target.is_file()
    for suffix in (".fastSmol", ".smolTM", ".smol", ".gbapal", ".4bpp", ".8bpp", ".1bpp", ".lz", ".rl"):
        if not relative.name.endswith(suffix):
            continue
        base = Path(str(relative)[:-len(suffix)])
        original = Path(*base.parts[2:])
        first = source / original
        fallback = source / base
        if first.is_file():
            input_path = original
        elif fallback.is_file() or generate_native_graphic(source, str(base), depth + 1):
            input_path = base
        else:
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        if suffix == ".smolTM":
            argv = [str(source / "tools/compresSmol/compresSmolTilemap"),
                    str(input_path), str(relative)]
        elif suffix in (".smol", ".fastSmol"):
            argv = [str(source / "tools/compresSmol/compresSmol"),
                    "-w", str(input_path), str(relative)]
            if suffix == ".fastSmol":
                argv += ["false", "false", "false"]
        else:
            argv = ["sh", str(source / "platform/build_glue/gbagfx_pad.sh"),
                    str(input_path), str(relative)]
        env = dict(os.environ, PAD_UNDER="build/assets-native")
        done = subprocess.run(argv, cwd=source, env=env,
                              capture_output=True, timeout=30)
        return asset_result(argv, done, target)
    return False

def probe(source: Path, compiler: Path, output: Path, sdl_include: Path, *, all_modules: bool = False, limit: int = 0, gba_division_ir: bool = False) -> dict:
    source = source.resolve()
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    obj_dir = output.parent / "game-object-probe"
    obj_dir.mkdir(exist_ok=True)
    if not (source / "include" / "constants" / "map_groups.h").is_file():
        raise RuntimeError("Generate Brisk map headers before ARM64 game compilation")
    if not (sdl_include / "SDL.h").is_file():
        raise RuntimeError("SDL2 Android headers are missing")
    cflags = [
        str(compiler), "-std=gnu17", "-fPIC", "-funsigned-char", "-O1",
        "-DMODERN=1", "-DEMERALD=1", "-DTESTING=0",
        "-DPLATFORM_NATIVE=1", "-DBRISK_NATIVE=1", "-DBRISK_ANDROID=1",
        "-I" + str(source / "platform"),
        "-I" + str(sdl_include),
        "-iquote", str(source / "include"),
        "-iquote", str(source),
        "-idirafter", str(source / "include"),
    ]
    passed = []
    failed = {}
    missing = []
    division_operations = 0
    # Expansion's game sources require the same preprocessor pipeline as
    # Makefile.native. Compiling .c directly leaves INCGFX and COMPOUND_STRING
    # untranslated and produces misleading errors.
    preproc = source / "tools" / "preproc" / "preproc"
    sed_filter = source / "platform" / "build_glue" / "c_filter.sed"
    if not preproc.is_file() or not sed_filter.is_file():
        raise RuntimeError("Native asset tools are missing; run make -f make_tools.mk")
    if all_modules:
        all_sources = sorted(
            path.relative_to(source / "src").as_posix()
            for path in (source / "src").rglob("*.c")
            if not path.name.endswith(".inc.c")
            and path.name != "siirtc.c"
            and len(path.relative_to(source / "src").parts) <= 3
        )
        priority = [name for name in PRIORITY_MODULES if name in all_sources]
        modules = priority + [name for name in all_sources if name not in priority]
        if limit:
            modules = modules[:limit]
    else:
        modules = list(PRIORITY_MODULES)
    for name in modules:
        src = source / "src" / name
        if not src.is_file():
            missing.append(name)
            continue
        try:
            cpp = subprocess.run(
                cflags + ["-E", str(src)], cwd=source,
                capture_output=True, timeout=90,
            )
            if cpp.returncode:
                failed[name] = cpp.stderr.decode("utf-8", "replace")[-3500:]
                continue
            generated = 0
            stage_error = None
            while True:
                pre = subprocess.run(
                    [str(preproc), "-i", "-g", "build/assets-native",
                     str(src.relative_to(source)), "charmap.txt"],
                    cwd=source, input=cpp.stdout, capture_output=True, timeout=90,
                )
                if pre.returncode == 0:
                    break
                stderr = pre.stderr.decode("utf-8", "replace")
                required = MISSING_ASSET.search(stderr)
                if required is None or generated >= 12000 or not generate_native_graphic(
                    source, required.group(1)
                ):
                    stage_error = (stderr[-2500:] or "Native asset preprocessing failed")
                    stage_error += f"\nAssets generated before failure: {generated}"
                    if generated >= 12000:
                        stage_error += "\nAsset conversion safety cap (12000) reached"
                    if required is not None:
                        stage_error += f"\nRequested asset: {required.group(1)}"
                    if LAST_ASSET_FAILURE:
                        stage_error += "\nConverter: " + LAST_ASSET_FAILURE
                    break
                generated += 1
            if stage_error is not None:
                failed[name] = stage_error
                continue
            filtered = subprocess.run(
                ["sed", "-f", str(sed_filter)], cwd=source,
                input=pre.stdout, capture_output=True, timeout=90,
            )
            if filtered.returncode:
                failed[name] = filtered.stderr.decode("utf-8", "replace")[-3500:]
                continue
            obj = str(obj_dir / (name.replace("/", "__").removesuffix(".c") + ".o"))
            if gba_division_ir:
                # The GBA defines /0 and INT_MIN/-1 results; Android hardware
                # does not. Generate unoptimized LLVM IR and redirect every
                # integer division to the verified APCS helper BEFORE -O2.
                llvm = subprocess.run(
                    cflags + ["-O0", "-Xclang", "-disable-O0-optnone",
                              "-S", "-emit-llvm", "-x", "c", "-o", "-", "-"],
                    cwd=source, input=filtered.stdout, capture_output=True,
                    timeout=90,
                )
                if llvm.returncode:
                    failed[name] = llvm.stderr.decode("utf-8", "replace")[-3500:]
                    continue
                try:
                    changed, metrics = transform_division_ir(llvm.stdout.decode("utf-8"))
                except ValueError as error:
                    failed[name] = str(error)
                    continue
                division_operations += metrics["rewritten"]
                compiled = subprocess.run(
                    [str(compiler), "-O2", "-fPIC", "-x", "ir", "-c",
                     "-o", obj, "-"],
                    cwd=source, input=changed.encode("utf-8"),
                    capture_output=True, timeout=90,
                )
            else:
                compiled = subprocess.run(
                    cflags + ["-c", "-x", "c", "-o", obj, "-"],
                    cwd=source, input=filtered.stdout, capture_output=True,
                    timeout=90,
                )
            if compiled.returncode:
                failed[name] = compiled.stderr.decode("utf-8", "replace")[-3500:]
            else:
                passed.append(name)
        except subprocess.TimeoutExpired:
            failed[name] = "Native compiler pipeline timed out (90 seconds per step)"
    report = {
        "target": "Android ARM64 Brisk game C source compilation",
        "pipeline": "NDK Clang -E | native preproc -i -g + genuine missing assets | c_filter.sed | NDK Clang -c",
        "source_directory": str(source),
        "all_game_C_sources_selected": all_modules,
        "modules_selected": len(modules),
        "modules_compiled": passed,
        "game_c_objects_in_source": len(list((source / "src").rglob("*.c"))) if all_modules else None,
        "target_is_complete_game": False,
        "linked_shared_game_library": False,
        "passed": passed,
        "failed": failed,
        "missing": missing,
        "gba_division_ir_enabled": gba_division_ir,
        "gba_division_operations_rewritten": division_operations,
        "passed_count": len(passed),
        "failed_count": len(failed),
        "missing_count": len(missing),
    }
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Android game C units: {len(passed)} compiled, {len(failed)} failed, {len(missing)} missing")
    for name, detail in failed.items():
        first = next((line.strip() for line in detail.splitlines() if "error:" in line),
                     detail.splitlines()[0] if detail else "Unknown compiler error")
        print(f"  {name}: {first[:210]}")
        if "Assets generated before failure: " in detail:
            print("    " + detail.split("Assets generated before failure: ", 1)[1].splitlines()[0])
        if "Converter: " in detail:
            print("    " + detail.split("Converter: ", 1)[1][-1100:])
    print("Detailed compiler report:", output)
    return report

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--compiler", type=Path, required=True)
    parser.add_argument("--sdl-include", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--all", action="store_true", help="Compile all game C modules, not just the 19 priority samples")
    parser.add_argument("--limit", type=int, default=0, help="With --all, compile only the first N modules")
    parser.add_argument("--gba-division-ir", action="store_true", help="Route all LLVM IR divisions through GBA APCS helpers")
    args = parser.parse_args()
    if args.limit and (not args.all or args.limit < 1):
        parser.error("--limit requires --all and a positive N")
    probe(args.source, args.compiler, args.output, args.sdl_include,
          all_modules=args.all, limit=args.limit, gba_division_ir=args.gba_division_ir)

if __name__ == "__main__":
    main()
