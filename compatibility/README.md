# Emerald compatibility packs

The `compat-branch` build is Emerald-only. It supports vanilla Emerald directly and can load additional Emerald-derived save layouts through JSON compatibility packs.

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
