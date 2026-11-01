# Native Brisk Emerald: capacity and remaining limits

This describes the native port of Brisk revision `8d2b525214a61a89563facde52c79a567ade560b`.
Counts below are internal IDs/table entries, including forms and reserved entries;
they differ from the number of unique Pokédex species displayed in Brisk Dex.

| Area | Native Brisk configuration / remaining limit | What expanding it requires |
| --- | --- | --- |
| Game assets | The GBA cartridge's 32 MiB file limit is removed. Assets are linked into a native executable. | The native linker layout and retained address-based scripts still constrain the image. |
| Game heap | 16 MiB, moved outside the emulated EWRAM region; allocation block sizes are widened to 32 bits. | A source/configuration change can raise this pool; low-address and compiler model constraints still apply. |
| Other EWRAM globals | The emulated window remains 256 KiB. Moving the heap out releases its former allocation there. | Move more host-only state outside the window or redesign fixed-address users. |
| Species IDs | Boxed Pokémon use 11 bits: highest stored ID 2,047. The current species table has 1,818 entries. | Widen the packed Pokémon/save representation to exceed the ID range. Forms consume IDs too. |
| DexNav extension | 1,695 legacy entries plus 256 extension entries: 1,951 total; 133 more entries before this bank must grow. | Expand the extension and migrate affected saved data. |
| Move IDs | Stored moves use 11 bits: highest ID 2,047. Current table count including special moves: 935. | Widen packed move fields and migrate saves to exceed that range. |
| Held item IDs | 10 bits: highest held-item ID 1,023. Current item table count: 943. | Widen packed held-item fields and migrate saves. |
| Saves and boxes | 128 KiB flash image, shared by two compressed profiles; 20 boxes × 30 Pokémon per profile. Saving needs copy-on-write headroom. | A larger native persistence format and migration; native execution alone does not enlarge the simulated flash chip. |
| Trainers | 1,489 configured trainer entries, with mode-specific teams and additional saved defeat flags. | Expand trainer tables/flag storage and version the save schema as needed. |
| Maps | Map group and map number remain byte-sized, with reserved values. | Widen IDs and update map/event/warp formats for a larger addressing scheme. |
| Graphics | 240×160 output; 96 KiB emulated VRAM; 64 engine sprites and 16 active overworld objects by default. | Changes to rendering, tile/palette management and game logic. Storing more artwork does not increase simultaneous graphics budgets. |
| Battle structure | Six party Pokémon and four active battlers. | Battle/UI/save changes for different party or battler limits. |

## Native addresses and code

The current native backend deliberately maps hardware-like regions at their GBA
addresses and links the program's code at `0x40001000`. The linker checks that
code ends below `0x42000000`, because an event-script function tag uses bit 25.
That is approximately a 32 MiB code window, separate from asset data. Some
bytecode address operands remain four bytes despite the executable being 64-bit;
the port is not an unrestricted 64-bit address-space game engine. The compiler's
code/data relocation model also remains relevant as the image grows.

## Save compatibility

Native Brisk uses its own save layout tag (`BRK1`) and an independent
`native-brisk-emerald` user-data directory. Its in-game two-profile system is
preserved. Existing base-expansion native saves stay in `native-expansion`.
GBA `.sav`/`.srm` files and 32-bit native saves require explicit conversion to
this 64-bit Brisk layout; they are not directly interchangeable. The Brisk Dex
companion's GBA save loader remains a separate feature.

## Sources for these values

- `include/pokemon.h`: packed species, move and held-item bit widths.
- `include/constants/species.h`, `moves.h`, `items.h`, `opponents.h`: table counts.
- `include/global.h`, `src/event_data.c`: legacy/extended DexNav capacity.
- `include/malloc.h`, `src/malloc.c`: native heap and block-size adaptation.
- `platform/flash.h`, `src/brisk_multisave.c`: flash geometry and compact profiles.
- `include/pokemon_storage_system.h`, `sprite.h`, `constants/global.h`: boxes and active-object budgets.
- `platform/gba_regions.pe.ld`, `gba_regions.ld`, `script_tag.h`: native address and code constraints.
