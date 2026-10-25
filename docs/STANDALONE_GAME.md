# Brisk Emerald standalone development

This is a playable, partial JavaScript remake, not an emulator and not the complete ROM campaign. The normal Dex app still has no link to it; online connections, trades, ranked eligibility, GBA save writes and unattended updates remain disabled.

## Run it

Use Node.js 22 or newer. Run `launch-game-prototype.bat` or `npm run game:dev`, then open <http://127.0.0.1:8790/game/index.html>. New journeys begin in the actual Brisk Littleroot map with a level-5 starter. Existing prototype-1 saves migrate while retaining their party, bag, flags and original field-station location.

WASD/arrows move; E/Enter interacts. NPCs, shopkeepers and nurses can be reached across counters. Info opens partner details, move relearning, held items and storage swaps. Bag buttons use supported healing items and EXP candies. Candies support multiple uses and queue move/evolution choices without losing levels. The old field station is retained for regression testing.

**Travel · dev** provides explicit development travel among the converted outdoor maps, including Orange City. It is a test tool, not a replacement for Hoenn's story or unlock requirements. Options includes difficulty, battle Bag, modern EXP sharing, general shiny odds and the Orange Islands shiny override.

## What was ported

- **90 source maps**, plus the four original testing maps: Littleroot and its lab/houses; Routes 101–104; Oldale and its houses/Mart/Center; Petalburg and its Mart/Center; Petalburg Woods; Rustboro and its Mart/Center/Gym; Slateport and its Mart; Orange City and its houses/Mart/Center; Routes 143–146.
- Actual three-layer map graphics, palettes, source NPC/player sprites, map dimensions, connections, door warps, terrain collision, counter interaction and directional ledges. Foreground graphics render above actors. Missing destinations remain outside the playable port.
- Brisk's existing catalog plus a source-derived native supplement: **1,676 level-up learnsets**, catch rates, EXP yields, EV-yield metadata, prices and Mega-item relationships. The unresolved learnsets are Greninja Bond, Mega Dragonite Y and Egg. Fallback moves are retained for incomplete records; Egg is not a playable species.
- **517 encounter slots** across the playable content, preserving source levels and weights. Encounters use source map encounter rates. The exact GBA per-step encounter algorithm is not yet replicated.
- **301 trainer interactions** using actual named teams, authored levels, moves, held items, natures, IVs and EVs where present. Variant names resolve by source constants so Alolan forms do not replace ordinary forms accidentally. Some source double-trainer interactions currently use sequential singles; local doubles controls remain unimplemented.
- **67 custom Mega stones** in Orange City's Mart, including native-only item metadata missing from the companion catalog. The runtime checks the exact held stone before exposing a Mega transformation. Temporary battle forms and abilities do not overwrite the saved base species.
- Source level-up moves replace the prototype's small generic move pool. Levels/EXP persist; moves can be learned/replaced or relearned; basic level/item evolutions work. Other evolution methods still need porting.
- The existing Dex relay's battle functions now also run in an **isolated offline engine**: status and setup moves, move effects, abilities, held items, switches, multi-member opponents, weather and transformations use that shared logic instead of the eleven-move prototype. The relay's coverage checker reports 366 effect families, but coverage is not proof of exact ROM parity.
- Held items, field Potions/Revives, multi-use EXP candies, healing Centers, party/storage swapping, catch-rate-based basic Poké/Great/Ultra/Master Ball logic, shiny settings and protected lead weather.
- Difficulty options currently control shop multipliers, easy/hard trainer IV/EV adjustments, AI selection, battle Bag restrictions and EXP sharing. They do **not** yet reproduce every ROM difficulty rule, dynamic trainer-level adjustment or level-cap exception. The offline AI is the Dex relay's AI, not the ROM's OMNISCIENT implementation.
- Independent IndexedDB saves, current/previous backups, checksum-verified JSON import/export and a compatible migration from prototype-1. Healing at a Center sets a recovery point; benches do not. GBA `.sav` conversion is still absent.

## Battle engine generation

`game/relay-engine.mjs` is generated from `battle-server.js` by `npm run game:battle-build`. The generator parses JavaScript with Acorn, follows battle-function dependencies, and rejects host/network/profile dependencies. It replaces online reward/provenance handling with a local battle-finish operation. Each battle receives its own seeded random function; no global random function or live server is changed.

The generated source is checked into the repository with the relay source SHA-256. Tests reject a stale copy after relay changes. Regenerate it whenever the shared battle logic changes. Native monsters never receive `rewardRaw80`, competitive-provenance bits, online prizes or ranked credentials. Integration DTOs remain a disconnected boundary.

The local runtime currently uses singles controls. Its catch calculations, status persistence, stat transitions and AI are still approximations where the relay differs from the GBA engine. Full gimmick access rules, doubles input, all ball bonuses, EV rewards, level caps and complete move/evolution parity need more work.

## Source conversion

The checked-in source revision is recorded in `game/native-catalog.json`, `game/content.json` and `game/port-report.json`.

```sh
python tools/port_native_content.py "/path/to/Pokemon Brisk Emerald"
```

Requires Pillow. It reads a local source checkout only; it does not download or modify the ROM project. The selected map list is explicit in the tool. It converts source metatile data and indexed palettes into ground/foreground PNGs, preserves usable warps/connections, exports supported NPC interactions, and reports unresolved scripts and external destinations.

`game/port-report.json` lists unresolved script interactions and external warp references. Conditional conversations, cutscenes, map-entry scripts, movement scripts, native specials, item pickups, many gifts, flags and quest progression are not generally interpreted. Readable dialogue may be displayed with an unported-story notice, but its story effects are not executed. Source NPCs hidden by story flags are generally omitted. Camera/traversal does not yet cover surfing, every elevation rule, sideways stairs or the complete field-move system. Tiles are static rather than using native tileset animations; music is not ported.

The older `tools/import_native_maps.mjs` remains useful for archiving arbitrary source maps and scripts before expanding the playable converter.

## Existing systems and updates

`game/integrations.mjs` supplies versioned read-only party data and canonical battle-team DTOs. All capability flags remain false. A future connection must add server-side authentication/ownership validation and catalog/ruleset pinning before allowing standalone monsters into any online economy. No normal Dex startup, matchmaking, trade or binary-save handler is connected to this runtime.

The staged `ContentUpdates` module still has no production endpoint or timer. It validates a pinned HTTPS origin, download size/hash, engine version and content schema before activation; incompatible maps/saves fail before active records change. Activation returns a validated pack/state pair and stores content-specific rollback records. A future launcher must explicitly open them together. It does not silently rewrite the prototype save, update JavaScript/catalog/artwork, or patch a GBA ROM. Production unattended releases will need a signed manifest and a migration/asset policy.

```sh
node tools/build_native_release.mjs game/content.json /tmp/brisk-native-release
```

This generates declarative content plus a manifest locally; nothing is published.

## Validation

- `npm run game:test`: 41 tests, including source traversal, all encounter spawns, trainer construction, Mega ability/base-form retention, level-up moves, candy/save retention, migration and update rollback.
- `npm run game:ui`: optional Playwright regression covering keyboard input, healing, shop purchase, save reload, trainer combat, mobile layout and atomic IndexedDB rollback.
- `npm run battle:coverage` / `npm run battle:smoke`: existing online engine checks, separately from the native runtime.
- `npm run web:build` / `npm run android:prepare`: include the runtime in directory builds without linking it from the live app. The generated single-file companion edition remains unchanged.

For browser tests, install Playwright locally (`npm install --no-save --package-lock=false playwright`, then `npx playwright install chromium`) or set `BRISK_PLAYWRIGHT_MODULE`/`BRISK_CHROMIUM_PATH` to an existing installation. `BRISK_SCREENSHOTS` optionally selects an existing screenshot output directory. Normal development play needs no Playwright installation.

Assets retain their Brisk source credits. Consult the Brisk Emerald and Brisk Dex credits for the original artists and systems; this converter does not replace those attributions.

## Further port: source event interpreter

The playable source selection now also covers Routes 105–134, Dewford, Granite Cave, Mauville, Verdanturf, Rusturf Tunnel, Lavaridge, Fallarbor, Fortree, Lilycove, Mossdeep, Sootopolis and Pacifidlog with selected Centers/Marts. These remain a partial story port; surfing and scripted access restrictions are not fully implemented. Development travel lets testers inspect disconnected areas.

`game/scripts.mjs` interprets source dialogue, flags, 16-bit variables, arithmetic, comparisons, branches, calls/returns and simple item gifts. It first plans the complete executed path against a copy, validates the result, and commits only when the path finishes successfully. Unsupported commands, missing shared labels, yes/no choices, variable overflows and loops cancel the whole interaction. No source is evaluated as JavaScript. Map-entry and coordinate-triggered story scripts, native specials, cutscenes and battle/script resumption are still unported. The original C script text is retained in the converted content for continued porting.

The existing companion catalog lacks Mothim's record. Trainer events requiring it are explicitly deferred rather than silently replacing its species or crashing. Their original teams are retained as unported metadata.

## Progression interpreter extension

Interactive NPC conversations now support yes/no choices and resume the selected branch, with cancellation and stale-state protection. Native-style item checks/removal, money transactions, Pokémon gifts (including storage overflow), HealPlayerParty, sequential label fallthrough, player-only movement tables and direct valid-map warps are supported. Whole-event validation and rollback still apply. Supported scripted movement updates position immediately; it does not yet reproduce native cutscene animation. NPC movement, shared specials and full story triggers remain unfinished. See [complete-game acceptance gates](COMPLETE_GAME_GATES.md).

## GBA save transfer

Use **Import GBA save** inside the development game. The read-only importer accepts raw Brisk Emerald `.sav`/`.srm` battery payloads (112/128 KiB), including padded/mirrored flash dumps up to 16 MiB, headers up to 4 KiB, short emulator footers, and gzip-compressed files, checks a complete consistent save bank, and validates current 20-box extension sectors. Legacy 14-box saves are supported. Corrupt/mismatched PC extension sectors cause rejection rather than clearing boxes. Arbitrary other hacks, emulator save states, ROMs and unknown future save layouts are not supported.

The preview reports playable party/storage counts, adjustments and archive-only records before replacing a native save. Current native progress becomes its backup. The GBA file is never written. The original bytes and SHA-256 are embedded in the native save; **Export original GBA** recovers that exact file, even after playing the remake. This is one-way transfer, not GBA/native synchronization.

Pokémon preserve source EXP, recalculated level, IVs/EVs, ability slot, held item, shininess, nickname, minted nature and PP Ups. Party HP is scaled when native stats differ; original values remain archived. Box positions and original per-Pokémon records are retained as metadata. Eggs, bad/corrupt records, unknown species and other unrepresentable entries are explicitly reported and remain recoverable in the original archive. If no playable party member can transfer, the first playable boxed Pokémon is promoted and reported; if none can transfer, import is rejected. Supported bag items, money and trainer identity transfer. Original box names, coordinates and all untouched binary data remain archived.

**Full story-resume compatibility remains incomplete.** Source-layout quest flags, script variables, badges and defeated-trainer flags now restore through the pinned story metadata. Unported scripts and systems still limit campaign continuity; all original progression bytes also remain archived. A valid mapped location can transfer, otherwise the starting location is used with a warning. The import must not be advertised as a complete replacement for the GBA campaign yet. Native imports never gain trusted online provenance.

`tools/build_gba_reader.mjs` extracts the existing Dex's byte decoder into an isolated module; the importer adds strict bank/extension validation. `game/gba-layout.json` pins source map-index metadata. Regenerate/review these against the actual ROM source when its save layout changes.

## Visible encounters

Visible Pokémon are enabled by default for new journeys and GBA transfers. Options select 3, 6 or 9 nearby Pokémon, or restore random encounters by disabling visible encounters. Source land/water encounter tables supply species and levels. Sprites retain their rolled identity, moves, level and shininess across saves; touch or interact with the visible Pokémon to battle that exact individual. High physical attack species approach, fast species flee, and others wander, staying on matching encounter terrain. Shiny hunting mode replaces wildlife after 8 steps instead of 60; it does not change the selected shiny odds. Sprites share depth ordering with NPCs and the player.

Save normalization is read-only and checksum-gated. Single-bank backups are rejected because expanded storage cannot be distinguished reliably when its extra sectors are missing. Corrupt/mixed generations remain errors. Import diagnostics include detected payload offset and original byte count. Original exports retain padding, headers, or gzip bytes exactly. Representative fixture tests cover these variants; a particular user's failed file must still be supplied to confirm its format.

## Movement and battle presentation

Movement input is serialized at a 150 ms walking cadence (100 ms while holding Shift), buffers short taps, prioritizes the latest held direction and clears on focus loss, hidden app views and modal interactions. Normal movement updates field controls without rebuilding the party/inventory DOM. Source route links preserve coordinate offsets; a persistent camera translates its previous position at crossings and renders adjacent maps, foregrounds and NPCs as one scrolling scene. Door/teleporter warps still snap to their destination. Connected crossings count as steps. Reduced-motion settings disable walking interpolation.

The battle command deck separates Fight, Bag and Pokémon. Move buttons show type/category/PP and expose power, accuracy and descriptions on hover. Keys 1–4 choose moves; F/B/P open command sections. Doubles have explicit targets and a current-Pokémon prompt. HUD cards preserve image elements across turns, display statuses and colored HP bars, and occupy separate lanes from sprites. Item availability and battle restrictions disable invalid choices. Transformation toggles apply to the next selected move. Desktop and narrow-phone battle layouts are checked for overlap/overflow; source route-crossing browser tests assert that the canvas is retained without resizing.

## Native screen, trainer pairs, and field controls

Battles now occupy one 240:160 game viewport, with a 112-line field and a 48-line command window. Fight/Bag/Pokémon controls share the lower window; doubles targets remain selectable in the message panel. Small screens show the four move names without requiring scrolling past the move metadata. Source dialogue uses a two-line window with an advance arrow and separate Yes/No choices; Enter/E/Space advances it, and Escape cancels a cancellable scene. Text speed is selectable (instant/fast/normal).

The visible **Menu** button and Escape open the game menu. Options include saved running controls (hold/toggle/always), theme, text speed, trainer sight, encounter options and difficulty. Hold Shift/B, use the on-screen Run toggle, or select always-run. Running uses the ROM's actual Brendan/May running sheets and a 100 ms step cadence. Fullscreen uses the browser fullscreen API with a reversible expanded-layout fallback.

Trainer sight collects all matching undefeated sight lines before starting a battle. With two healthy player Pokémon, two spotted trainers join one double battle and each opens with their own lead. Both complete teams are retained (up to twelve opponents in the isolated offline engine). Both defeated flags are committed only on victory; their post-battle source scripts can then run. With fewer than two healthy Pokémon the ordinary single-trainer flow remains available. Hidden/defeated trainers and the talk-only option are respected.

Both map layers and changed metatiles share a camera origin snapped to the 2× source-pixel grid, preventing fractional tile edges from exposing seams. Wildlife atlas generation supports 32/64 pixel frames, eight-frame asymmetric sprites and vertical strips. The atlas resolves 1,677 species/form entries through source art and documented regular-form/evolution-family/closest-species aliases; Egg and Alcremie G-Max have no atlas entry. Custom substitutes include Centiskorch for Pythonova, Exeggutor for Baoby and Alolan Exeggutor for Baobaraffe. These are explicit substitutes, not newly drawn original sprites. Exporting palettes/sheets remains reproducible with `tools/export_wild_sprites.py <ROM-checkout>`.

`npm run game:ui:features` checks fullscreen, saved options, running animation, text layout and a real two-trainer victory. Graphics tests validate atlas rectangles and snapped tile edges.

## Detailed game interface

Party summaries now have Overview/Stats/Moves tabs, HP and EXP bars, source ability descriptions, nature, held-item controls, and IV/EV tables. Relearning/evolution actions use the existing campaign rules. Held-item give/take operations validate inventory capacity and item eligibility before changing either side.

The Bag browser searches names/descriptions with accent-insensitive matching, filters pockets, sorts quantities and shows existing item icons and descriptions. Supported field medicine and EXP candy can be used on party members; eligible evolution items and held items have explicit actions. Unsupported field effects are not advertised as usable. The field kit remains a compact eight-item preview, prioritizing medicine/candy, with the full bag one click away.

Storage browses the whole native collection with paging, search, level/name sorting and a shiny filter. Filtered rows retain their original indexes so selecting a search result swaps the intended Pokémon, including slots past 100. Returning from a stored summary restores its previous search/page.

A read-only area map shows the current position and source map connections. Battle details (button or **I**) shows full current move descriptions/PP and the complete local battle log on desktop or touch. HP-change feedback accounts for all four active doubles slots, ignores switched-in identities, and respects reduced-motion settings. Menu tabs support arrow/Home/End navigation. Source dialogue retains focus on its choices and makes background field controls inert; keyboard confirmation follows the focused choice. The field has a visible saved/unsaved indicator and a touch Talk action.

Run `npm run game:ui:interface` for end-to-end checks covering summaries, held-item transfers, medicine, a filtered swap at slot 125, area maps and narrow-phone layout. These changes remain local; online/trade integration is disconnected.
