# Adapt Dex compatibility packs (Gen 1–3)

## ROM-first launch

On every app launch, select a locally stored `.gba` ROM, optionally select its `.sav` or `.srm` file, and press **Enter Brisk Dex**. The game reference views are populated from identifiable ROM tables or the validated embedded index. If no save is supplied, Brisk Dex opens the Pokédex without importing any previous save. A save may be added later from the normal **Load .sav / .srm file** button. **Change game** returns to the chooser via reload.

When a ROM lacks reliably extractable data, the chooser remains open and displays an actionable import error. Partial ROM scans list their unavailable fields. For an extensive game-specific dataset, generate a source-matched ROM index as described in [ROM_IMPORT.md](ROM_IMPORT.md). A ROM import never grants write permission to a save whose layout cannot be established.

The `adapt-dex` targets Generation 1–3 ROM hacks: GB/GBC Gen 1–2 cartridges open using the classic ROM scanner; Gen 3 GBA uses the GBA extractor. The editable save implementation remains Emerald-family Gen 3; GB/GBC SRAM is inspected read-only, and no save writes are authorized without a verified game-specific layout. Gen 3 non-Emerald variations also require a matching profile before writes. Ruby/Sapphire and FireRed/LeafGreen use separate checksum lengths and party positions when inferable; they do not inherit Emerald's bag/dex offsets by default.

A compatibility pack can contain one `profile`, an array of `profiles`, and optional `data` / `gameData` used by the Pokédex, Move Dex, Item Dex, Ability Dex, encounter tables, and trainer data.

## Safety model

- Auto-detected Brisk saves are writable because the expanded PC extension is a strong fingerprint.
- A generic Emerald-looking save opened on **Auto detect** is read-only because a `.sav` normally cannot identify its ROM hack with certainty.
- Explicitly selecting a trusted writable profile enables save editing.
- Profiles can set `writePolicy: "readonly"` while a layout is still experimental.
- Before a disk write Brisk Dex keeps the untouched bytes, validates save-section checksums, reparses the edited file, checks trainer/party/box identity, and verifies Pokémon checksums.
- Cross-profile Pokémon transfers are converted instead of copied byte-for-byte. Unsupported species, moves, items, or mechanics block the transfer.

## Main profile areas

`save` describes Emerald save blocks, offsets, signatures and checksum lengths.

`pokemon` describes field masks and custom bits in the encrypted 80-byte / 100-byte Gen III Pokémon structure.

`pc` describes box count, standard PC sections, and optional extra physical save sectors.

`bag` describes pocket offsets/capacities and quantity encryption.

`dex` describes seen/caught storage.

`idMaps` maps raw hack IDs to the display IDs used by the app.

`fingerprints` are optional byte/sector checks used for high-confidence auto-detection.

See `emerald-compat-profile.schema.json` and `example-expansion-pack.json`.

## Fingerprints

Supported fingerprint rules currently include:

- `file-size`
- `min-file-size`
- `u16` at a fixed file offset
- `u32` at a fixed file offset
- `pc-extension` sector/id/signature
- `context`

Do not use weak fingerprints to enable writes. Prefer a read-only profile when a hack cannot be uniquely recognized.

## Game-data packs

The optional data object can provide the same fields the existing Brisk data importer accepts, including `species`, `moves`, `items`, `abilities`, `itemDetails`, `moveDetails`, `abilityDetails`, `routeEncounters`, `trainerTeams`, and `changes`.

## Direct .gba ROM importing

The compatibility build also reads game data directly from local GBA ROM files. The base reader detects Emerald/Expansion headers, recoverable species data and icon graphics. Full trainer, route, custom form and shiny icon coverage is available from an indexed ROM built using the source-matched indexer. See [ROM_IMPORT.md](ROM_IMPORT.md) for the on-ROM format, setup and limitations.
