# GBA ROM import (compat-branch)

**A ROM contains game code and tables, not a universal directory of its features.** Each Emerald hack can relocate, resize or redefine species, trainer, item and map structures. This importer never pretends to have recovered tables that it cannot identify. It is a *read-only reference importer* and does not change the compatibility profile of an open `.sav`.

## Using it

In Brisk Dex, open **Settings → Import game from .gba ROM**, select your locally stored `.gba`, and read the coverage report. The file is parsed locally in the app; it is not sent to GitHub or the battle server.

There are two import levels:

| Input | Recovery |
| --- | --- |
| Ordinary Emerald-family ROM | GBA header, Game Freak ROM header and RHHEXP metadata when present; species names, stats and icon graphics when their table layouts can be verified; move names on compatible vanilla layouts |
| Indexed ROM (`BDXROM1!` or `BDXROMZ!`) | All indexed data fields: Pokémon and custom species/forms, moves, abilities, items, route and wild encounter tables, trainer rosters, changes, and normal/shiny icons |

The report gives precise counts and warns about unavailable tables. Unknown trainers, routes or icon palettes are never fabricated. Expanded ROM species IDs are kept as raw ROM IDs; their mapping to save IDs remains the responsibility of a matching compatibility profile.

## Making a single-file, fully indexed Brisk Emerald ROM

When building Brisk Emerald from source, regenerate the reference data **from the exact same game revision** first:

```sh
python tools/extract_data.py /path/to/Pokemon-Brisk-Emerald
npm run rom:index -- /path/to/game.gba
```

Run these commands from the **Brisk-Dex** project root. The Python extractor needs Pillow and is source-based; the indexer uses the resulting `brisk-dex-data.json`, `brisk-dex-trainer-teams.json`, and the normal/shiny PNGs in `brisk-dex-icons/`. The output is `game-indexed.gba` next to the original ROM. To select a different destination:

```sh
npm run rom:index -- /path/to/game.gba /path/to/game-indexed.gba
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

The entire trailer fits in the ROM image (or its verified padding), with a maximum **12 MiB** inflated JSON document. The parser also inspects the standard `GFRomHeader` and `RHHEXP` structures where present. Data from a ROM index is accepted only after checking the marker, size, checksum and schema identifier.

## Save compatibility and limitations

Loading a ROM does **not** authorize writes to an unknown hack's `.sav`; save write policies remain conservative and independent. Reference data is persisted in local storage where possible; very large icon collections may need re-importing after a restart. ROM identity and save identity are not yet cryptographically tied to each other, so do not assume an unknown `.sav` matches a loaded ROM. Trainer teams from alternate difficulty modes are represented only when the matching source extractor and manifest contain them. Features implemented procedurally in code (e.g., runtime-generated encounters or randomized teams) cannot always be reconstructed as a finite ROM table.
