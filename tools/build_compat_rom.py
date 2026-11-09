#!/usr/bin/env python3
"""Build a portable, source-indexed Emerald-family ROM for Brisk Dex.

This reads a matching pokeemerald or pokeemerald-expansion source checkout,
exports added species, items, trainers, all maps, encounters and artwork,
and embeds the reference index in a COPY of the compiled .gba. No files
in the game source checkout or input ROM are modified.

Usage:
  python tools/build_compat_rom.py --rom game.gba --source ./game-source \
      --output game-indexed.gba
  Add --no-art to fit ROMs with unusually large sprite/audio collections.
"""
import argparse
import pathlib
import subprocess
import sys
import tempfile


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rom", type=pathlib.Path, required=True, help="Compiled .gba file")
    parser.add_argument("--source", type=pathlib.Path, required=True,
                        help="Matching pokeemerald or pokeemerald-expansion source checkout")
    parser.add_argument("--output", type=pathlib.Path, required=True, help="New indexed .gba file")
    parser.add_argument("--no-art", action="store_true",
                        help="Omit battle sprites, shiny artwork and cries to reduce index size")
    parser.add_argument("--no-icons", action="store_true", help="Omit Pokémon icons")
    parser.add_argument("--save-profile", type=pathlib.Path,
                        help="Verified game-specific Emerald save profile JSON; defaults to source/briskdex-compat-profile.json when present")
    args=parser.parse_args()
    rom=args.rom.expanduser().resolve()
    source=args.source.expanduser().resolve()
    dest=args.output.expanduser().resolve()
    if not rom.is_file() or rom.suffix.lower() != ".gba":
        parser.error("A compiled .gba ROM file is required")
    if not source.is_dir() or not (source/"include/constants/species.h").is_file():
        parser.error("The source checkout needs include/constants/species.h")
    if dest==rom:
        parser.error("Output must be a different file from the original ROM")
    if dest.exists():
        parser.error("Output already exists; existing game builds are never overwritten")
    tools=pathlib.Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix="brisk-dex-compat-") as tmp:
        work=pathlib.Path(tmp)
        print("Extracting game-specific reference tables, routes, trainers and custom assets...")
        subprocess.run([sys.executable,str(tools/"extract_data.py"),str(source)],
                       cwd=work,check=True)
        game_data=work/"brisk-dex-data.json"
        trainer_data=work/"brisk-dex-trainer-teams.json"
        if not game_data.is_file() or not trainer_data.is_file():
            raise RuntimeError("Source extraction did not produce the required game and trainer tables")
        dest.parent.mkdir(parents=True,exist_ok=True)
        argv=[sys.executable,str(tools/"embed_rom_index.py"),str(rom),
              "--output",str(dest),"--data",str(game_data),
              "--trainers",str(trainer_data),"--icons",str(work/"brisk-dex-icons")]
        if not args.no_art:
            argv.append("--with-art")
        if args.no_icons:
            argv.append("--no-icons")
        save_profile=(args.save_profile.expanduser().resolve() if args.save_profile
                      else source/"briskdex-compat-profile.json")
        if args.save_profile and not save_profile.is_file():
            parser.error("The requested game-specific save profile JSON does not exist")
        if save_profile.is_file():
            argv.extend(["--save-profile",str(save_profile)])
        try:
            subprocess.run(argv,cwd=work,check=True)
        except subprocess.CalledProcessError:
            if not args.no_art:
                print("If the GBA 32 MiB capacity or compressed-index budget was exceeded, "
                      "retry with --no-art. This build never modifies the source ROM.",file=sys.stderr)
            raise
        print("Open the output ROM in Brisk Dex. Its source-indexed names, routes, "
              "Fakémon, trainer rosters, items and included art will load locally.")
        print("Important: use source from the SAME revision as the compiled ROM. "
              "An index fingerprint binds the metadata to the ROM bytes, not to the source revision.")


if __name__=="__main__":
    run()
