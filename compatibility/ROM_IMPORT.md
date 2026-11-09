# GBA ROM import (compat-branch)

**A ROM contains game code and tables, not a universal directory of its features.** Each Emerald hack can relocate, resize or redefine species, trainer, item and map structures. This importer never pretends to have recovered tables that it cannot identify. It is a *read-only reference importer* and does not change the compatibility profile of an open `.sav`.

## Using it

At startup, choose a local `.gba` ROM, optionally add a `.sav`/`.srm` save, and press **Enter Brisk Dex**. Data stays on your device; no game files are uploaded to a server.

There are two import levels:

| Input | Recovery |
| --- | --- |
| Ordinary Emerald-family ROM | GBA header, Game Freak ROM header and RHHEXP metadata when present; species names, stats and icon graphics when layouts can be verified (including recognizable custom/Fakémon slots); move, item and ability names, including expanded item IDs, when table layout and anchors are verified; compiled standard-layout wild encounters when a sufficiently long, internally consistent map table is found. For those maps, the app reports **map group/number**, not guessed route names, and marks unknown encounter odds. |
| Indexed ROM (`BDXROM1!` or `BDXROMZ!`) | Source-indexed Pokémon, Fakémon/forms, moves, abilities, items, all maps, custom routes, wild/static/gift encounters, trainers and normal/shiny icons; battle sprites, animations and cries are embedded with `--with-art` when space permits. |

The report gives precise counts and warns about unavailable tables. The indexed source extractor no longer drops Kanto/FireRed-labelled encounter areas or other custom regions, and includes gift/static encounters even when a fork lacks a standard wild-encounter JSON file. Unknown trainers, routes or icon palettes are never fabricated. Expanded ROM species IDs are kept as raw ROM IDs; their mapping to save IDs remains the responsibility of a matching compatibility profile.

## Indexed ROMs for other open-source Emerald hacks

Use a **matching** compiled ROM and pokeemerald-family source checkout:

```sh
python tools/build_compat_rom.py --rom /path/to/game.gba --source /path/to/source --output /path/to/game-indexed.gba
```

The builder extracts supported custom Pokémon/Fakémon, items, moves, abilities, maps, encounters and trainer parties. It includes front/back/shiny artwork, animations and cries where available. Install Pillow for richer sprite processing (`python -m pip install Pillow`). Use `--no-art` or `--no-icons` if artwork exceeds the 32 MiB GBA ROM limit or the 12 MiB compressed-index budget.

It does not alter the input ROM or source checkout. The output index contains a SHA-256 fingerprint of the ROM's live executable data; Brisk Dex verifies this when importing, including on Android without WebCrypto. This does not prove the source checkout matches that compiled ROM revision.
## Making a single-file, fully indexed Brisk Emerald ROM

On Windows, **`index-brisk-rom.bat`** is the one-step entry point. Double-click it and enter the compiled `.gba` path and the matching Brisk Emerald source folder. It extracts Pokémon, Fakémon, abilities, trainer teams, encounters, **all map definitions**, icons and shinies, then writes `*-indexed.gba`. It requires Python with Pillow; it never overwrites the original ROM.

When building Brisk Emerald from source, regenerate the reference data **from the exact same game revision** first:

```sh
python tools/extract_data.py /path/to/Pokemon-Brisk-Emerald
npm run rom:index -- /path/to/game.gba
```

Run these commands from the **Brisk-Dex** project root. The Python extractor needs Pillow and is source-based; the indexer uses the resulting `brisk-dex-data.json`, `brisk-dex-trainer-teams.json`, and the normal/shiny PNGs in `brisk-dex-icons/`. The output is `game-indexed.gba` next to the original ROM. To select a different destination:

```sh
npm run rom:index -- /path/to/game.gba /path/to/game-indexed.gba
```

For computers without Node.js, the Python standard-library indexer produces the same ROM format:

```shpython tools/embed_rom_index.py /path/to/game.gba --output /path/to/game-indexed.gba
```

The source ROM is left untouched. The indexer compresses the data with zlib, validates its size, and adds a CRC32 footer that the app verifies before loading. It uses only existing `0xFF` tail padding or expands the output to the next power-of-two ROM size, never above **32 MiB**. If space is insufficient, the command *fails safely* and the build needs additional reserved ROM space. This is a reference-metadata embedding workflow, **not** a universal binary decompiler. Emulator/hardware boot testing of the new output is required before publishing; the tool does not claim that every ROM modification will work on every flashcart.

If assets push the index over the ROM space budget, pass `--no-icons` to the indexer to omit PNG assets. The importer can still try to decode icons directly from recognized ROM graphics tables, but colors/palette identification in custom expansion structures can be incomplete.

## Indexed ROM format (for other hacks and tools)

The uncompressed JSON must be UTF-8 with the following top-level structure:

```json
{
  "format": "briskdex-rom-v1",
  "meta": {"source": "My Emerald build"},
  "data": {
    "species": {"1": {"name": "Bulbasaur"}},
    "moves": {"1": "Pound"},
    "items": {},
    "abilities": {},
    "itemDetails": {},
    "moveDetails": {},
    "abilityDetails": {},
    "movePP": {},
    "routeEncounters": [],
    "trainerTeams": [],
    "changes": []
  },
  "assets": {
    "icons": {"1": "data:image/png;base64,..."},
    "shinyIcons": {}
  }
}
```

The existing Brisk Dex `brisk-dex-data.json` and `brisk-dex-trainer-teams.json` formats are the canonical field schemas for these entries. A `trainerTeams` entry includes `name`, `class`, `party`, `locations`, etc.; `routeEncounters` entries include named routes, methods and species/level/chance slots.

Two trailer encodings are supported:

- Raw: `[UTF-8 JSON][uint32 LE payload length][uint32 LE CRC32 of payload][ASCII BDXROM1!]`
- Compressed: `[zlib-deflate JSON][uint32 LE compressed length][uint32 LE CRC32 of compressed bytes][ASCII BDXROMZ!]`

The entire trailer fits in the ROM image (or its verified padding), with a maximum **48 MiB decoded** JSON document and a **12 MiB compressed** index budget. The parser also inspects the standard `GFRomHeader` and `RHHEXP` structures where present. Data from a ROM index is accepted only after checking the marker, size, checksum and schema identifier.

## Save compatibility and limitations

Loading a ROM does **not** authorize writes to an unknown hack's `.sav`; save write policies remain conservative and independent. If the source checkout provides a complete `briskdex-compat-profile.json` (or the builder receives `--save-profile <path>`), its layout is included in the indexed ROM. Only a SHA-256-verified indexed ROM, a full layout declaration, and independently matching hack-specific save fingerprints can automatically select that profile for writing. Otherwise the app stays read-only. File size or a ROM title alone never authorizes writing. Imported ROM reference data and ROM-specific icons are held separately for the current app session to avoid leaking one hack's IDs or trainer teams into another. Select a ROM each launch, or use **Choose another ROM** to return to the chooser. Brisk Dex locally remembers an observed trainer-save/ROM association and warns when that save is opened with a different ROM fingerprint. This is not proof that the first pairing was correct. Unknown save structures stay read-only until a matching trusted profile is available. Trainer teams from alternate difficulty modes are represented only when the matching source extractor and manifest contain them. Features implemented procedurally in code (e.g., runtime-generated encounters or randomized teams) cannot always be reconstructed as a finite ROM table.
