# Brisk Dex native-only 10,000-species capacity project

**Scope:** Brisk Dex's embedded native game and its companion storage only.
Do **not** alter the original Pokémon Brisk Emerald GBA ROM or change its save layout.

## Requested capacity

| Area | Target | Status |
|---|---|---|
| Species ID representation | At least 10,000 actual IDs, including forms | **Not yet migrated** (native boxed record stores 11 bits) |
| DexNav | Search/chain capacity for 10,000 species IDs | **Not yet migrated** (currently 1,951 entries) |
| Wild encounters | 64 walking + 32 surfing slots per map/time of day | **Implemented on branch** in `tools/expand_native_encounters.py` |
| External storage boxes | On-demand 30-slot boxes with no preset box-count maximum | **Implemented on branch** in Brisk Dex companion UI |
| In-game PC boxes | On-demand, disk-backed pages with no fixed number of boxes | **Not implemented** (native game still uses 20 boxes) |

The on-demand external box UI keeps using Brisk Dex's existing external-storage
archive format, adding a per-entry `boxIndex`. Legacy flat archives are spread
across 30-slot boxes in memory and remain import/export compatible. The archive
itself still loads into RAM, so practical storage is bounded by disk, memory,
and the app's performance; it is not literally infinite.

## Migration is mandatory before switching on 10,000 IDs

1. **Pokémon record ABI.** `include/pokemon.h` packs a species into 11 bits.
   Change **native only** to a >=14-bit field and account for the larger
   `PokemonSubstruct0` / 80-byte boxed record, plus party record changes.
   Update the source-code readers, Wonder Trade generator, trainer/PC views,
   save editors and serializers to accept the new record layout while still
   accepting legacy GBA/BRK1 records explicitly.
2. **Save version.** Native `BRK1` currently uses a 128-KiB PENSAVE flash
   image and two compressed profiles. Changing struct sizes without a converter
   would make all existing profiles fail the `RawSize()` check. A native v2
   persistence layer must detect and convert v1 profiles, retain the originals
   as backups, and commit the new format atomically. Do not switch versions
   until round-trip migration tests pass.
3. **DexNav.** Preserve the legacy 1,695-byte bank and 256-byte extension when
   loading old saves; allocate new per-profile space for at least 10,000
   search-level entries. Update seen/caught flags and list iteration. Check all
   overflow/bounds guards and the native memory layout.
4. **In-game PC.** Replace `TOTAL_BOXES_COUNT=20` with virtualized, disk-backed
   30-slot box pages. Keep only displayed boxes in memory; use 32-bit indices
   in logic, update the PC's box-selection UI, and handle transfers across
   pages. Must be transactional and isolated between the two native profiles.
   **Do not** replace 20 with a giant static number—flash saves and byte-sized
   current box indices will fail.
5. **Encounter diversity.** The first stage raises land/water encounter slot
   capacity without populating it with duplicate Pokémon. The 64/32 padded
   entries use `SPECIES_NONE` and zero appended encounter rates, preserving
   original species and gameplay probabilities. Fishing and Rock Smash use
   separate hardcoded selectors and need their own rewrites before expanding.
6. **Reflection graphics.** `src/field_effect_helpers.c` currently asserts
   `NUM_SPECIES <= 0x0800`. A native-only palette-tag namespace must be
   redesigned before the species count crosses 2,048.
7. **Validation.** Test ID 1, 2,047, 2,048, 9,999 and reserved sentinel;
   both profiles; full PC pages; save/restart; DexNav chains; all encounter
   methods; and reading legacy GBA saves without changing them.

**Release gate:** Do not merge or ship 10,000-ID/embedded-PC changes until a
v1→v2 migration and game-engine replay pass. Until then, the **native game**
retains the old ID, DexNav, and in-game PC limits.
