# Brisk Emerald standalone game foundation

This is the beginning of a native JavaScript remake, not a GBA emulator or a completed Hoenn port. It runs without a ROM and shares Brisk Dex's existing Pokémon catalog and sprites. It has its own rendering, world state, battles and saves. GBA ROM sizes and sprite-memory limits no longer govern this runtime, although devices still have normal memory/performance limits.

## Try the development build

Install Node.js 22 or newer, then run `launch-game-prototype.bat` or `npm run game:dev` and visit <http://127.0.0.1:8790/game/index.html>. No dependency installation is required for this entry. WASD/arrows move; E/Enter interacts with the tile you face. Touch movement buttons are available. Choose Treecko, Torchic or Mudkip at level 5.

The field station has grass encounters using actual Brisk species, a level-3 Zigzagoon rival battle, a healing bench, an indoor lab with healing and supplies, a sheltered cave, and a protected sandstorm chamber. These are intentionally new test maps, not replacements for the ROM's maps. Go to the building door in the northwest for the lab; go north along the main path for the cave. The scientist/shopkeeper sells Poké Balls, Potions and Linking Cords. The field's bench is just northwest of the starting position. Use Info on a party member for stats, supported evolutions, and swapping with caught Pokémon in storage.

The normal Dex interface/startup does not link to or launch this page. Desktop, web and mobile directory builds include its files for development, but no production tab, network endpoint, IPC handler or online transfer is enabled. The existing generated single-file Dex edition remains a companion-only app.

## Implemented

- Seeded encounters and combat, grid collision, object interaction, warps, indoor/outdoor classification and protected map weather.
- Species, types, stats, legal ability slots, IVs, EVs, natures, growth curves and artwork read from `brisk-dex-data.json`.
- One-on-one battles with a small explicit basic-move allowlist, PP, type effectiveness, STAB, priority, speed, accuracy, critical hits, switching, Potions, catching, escape, victory EXP and trainer rewards. A defeated opponent cannot send an extra species.
- Level growth, basic `EVO_LEVEL`/`EVO_ITEM` evolutions, a six-member party and overflow storage. Other evolution methods are deliberately unresolved rather than guessed.
- Healing restores HP, PP and status without changing a respawn point.
- Lead-ability field weather does not affect the lab or cave and cannot replace protected weather. Visual effects can be disabled.
- Independent versioned campaign saves in IndexedDB, atomic current/previous-save commits, portable JSON exports with SHA-256 corruption checks, validated imports, and backup restore. Autosaves happen outside battles, roughly every 30 seconds after changes, and after leaving a battle/healing. Export is also available if persistent storage fails.
- An explicit future content-release format, bounded HTTPS downloads, SHA-256/size/engine/schema checks, staged activation, compatibility validation, and transactional rollback records. No remote source or automatic update task is configured.
- A source-map archiver for real Porymap data, preserving all events, native collision/elevation/metatile IDs, tileset references, connections and original scripts. It reports unresolved scripts/destinations instead of silently discarding story logic.

## Boundaries and missing work

The local battle module is a **prototype**, not battle-engine parity. Only eleven basic move IDs are supported. Starting moves are chosen from legal learnable moves in the catalog; the catalog does not contain a level-by-level learnset. Some catalog move extraction metadata is incomplete, so the allowlist prevents accidentally treating complex moves as basic attacks. Catch rates use a clearly marked temporary formula, not the ROM formula. Abilities have only a small implemented subset; held-item effects, all gimmicks, doubles, full status mechanics, move learning, EV rewards and story progression still need porting. The old online battle engine remains intact and separate.

There is no GBA `.sav` import, binary-save rewrite, online battle connection, trading, ranked eligibility, full map artwork conversion, story script interpreter, music port, or ROM auto-patching. A corrupt/incompatible save is reported, not silently replaced. Different content versions require a compatible migration/activation; downgrades and removed maps are not automatically remapped. Application/catalog upgrades will need explicit save migrations when IDs or stats change.

The content updater currently handles declarative map/event JSON only. It does not download executable JavaScript, replace the app, patch a GBA ROM, update the species catalog, or perform a live release. `ContentUpdates.activate()` returns a validated `{pack,state}` pair and writes content-specific active/campaign/rollback records; a future launcher must explicitly open those records together. It does not silently rewrite the prototype's current save. HTTPS + pinned origin + hash protect transport/integrity; the checksum is not a publisher signature. A production launcher should add signed release manifests and a release policy before enabling unattended installs.

## Integration contracts (disconnected)

`game/integrations.mjs` provides:

- `partySnapshot(campaign)`: schema-versioned trainer/party data for a future read-only Dex panel.
- `battleTeam(campaign)`: canonical catalog-derived stats/moves in the existing relay's broad team shape.
- `IntegrationBridge.prepareBattle(campaign, 'singles' | 'doubles')`: a versioned battle request for a future host. Doubles here is a request format, not local doubles combat.
- Frozen capability flags that are all false; connection and transfer methods explicitly reject calls.

These DTOs never manufacture `rewardRaw80`, competitive-provenance flags, online prize records or ranked credentials. Existing relay verification must remain in place. Before connecting anything, add an authenticated native-campaign protocol to the server, reconstruct stats server-side, pin catalog/ruleset versions, and decide how standalone ownership is verified. Offline prototype monsters must not be accepted as verified GBA Pokémon or injected into ranked, trades or save-backed prize systems.

## Source-map migration

```sh
node tools/import_native_maps.mjs "/path/to/Pokemon Brisk Emerald" world-archive.json LittlerootTown Route101 OldaleTown
```

Output is a staging archive, **not playable content** (`runtimeReady: false`). Porymap's metatile collision bits are preserved, but ledges, doors, surf, elevation transitions, flags and native scripts need explicit ports. Original graphics/tileset conversion and a runtime event interpreter are the next major tasks. Keep the archive outside the live prototype until those steps pass traversal/story checks.

## Build a future content release

```sh
node tools/build_native_release.mjs game/content.json /tmp/brisk-native-release
```

This writes `content.json` and a hashed `release.json`. It does not upload or publish them. A future host must supply an explicit HTTPS manifest URL and matching allowed origin to `ContentUpdates`, show/check release compatibility, and use `ContentRecords` for persistent transactional activation. Keep stable map/event/flag IDs between compatible releases.

## Tests

`npm run game:test` covers world traversal, weather exclusions, legality, level retention, evolution, storage, corruption detection, update integrity/rollback, disconnected integration contracts and source-map preservation. `npm run battle:coverage` and `npm run battle:smoke` verify the existing online system separately. The native workflow runs both test sets without connecting the new runtime to the relay.

Optional browser regression: install Playwright locally without changing the manifest (`npm install --no-save --package-lock=false playwright` and `npx playwright install chromium`), then run `npm run game:ui`. The script starts its own loopback server and checks desktop/mobile layout, starter selection, movement, healing, warps, shopping, real IndexedDB persistence, trainer battles, disabled online capabilities and rollback on a failed content transaction. `BRISK_PLAYWRIGHT_MODULE` and `BRISK_CHROMIUM_PATH` can point to existing test installations. `BRISK_SCREENSHOTS` optionally specifies an existing output directory for screenshots.
