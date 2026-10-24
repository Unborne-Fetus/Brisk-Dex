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
