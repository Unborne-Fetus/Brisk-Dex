# Native Brisk Online Battles — engine parity requirements

**Status:** Design and integration boundary; the existing Online Battle mode is still the separate JavaScript implementation. It is **not** a perfect Brisk Emerald battle replica. Do not advertise native parity or switch matchmaking to this mode until the native battle API and real two-player tests pass.

## Why embedding the game isn't enough

The integrated executable streams GBA frames and receives button inputs. The native platform's networking implementation is absent, and the Dex relay does not have a callable battle-state API. The existing `battle-server.js` separately implements moves, abilities, damage, and turn resolution, so new Brisk mechanics do not automatically appear online.

## Required native adapter

1. Build a native `--battle-server` mode from the exact pinned Brisk Emerald source and expose an authenticated local turn protocol. Never accept arbitrary paths or code from matchmaking clients.
2. Import each player's six selected Pokémon through a validated team format shared with the save reader: species/forms, gender, level, actual IVs/EVs, nature, moves/PP, ability, held item, shininess, battle-specific status, and both sides' battle gimmicks.
3. Let **native game battle code** own battle turn order, damage, AI, switching, statuses, abilities, Mega/Z/Tera/Dynamax, doubles, RNG, weather, terrain, items, and end-of-turn effects. Clients submit legal choices only. Never reimplement a subset of formulas in JS for native matches.
4. Use an authoritative server instance and commit/reveal or server-owned RNG to prevent clients choosing the outcome. Accept exactly one choice per side per turn and report only public knowledge, with separately tested visibility rules.
5. Require both players to agree on the same **Brisk game revision**, custom content IDs, battle format, ban rules, and versioned team/turn protocol. Replay every turn deterministically and compare checksums. Reject a mismatch, don't guess.
6. Protect saves: battles import read-only teams; prize Pokémon and results are committed only after validated results, never by writing the game's compact flash from a remote client.
7. Unit-test native damage, switch, and ability edge cases; then run full cross-platform Windows/Linux doubles/singles matches against the actual game engine before allowing ranked.

## Migration contract

Retain the current relay and its profiles, lobbies, trades, and matchmaking. Introduce `engine: 'brisk-native-v1'` only when the native executable exposes a working versioned simulator interface and all parity checks pass. Keep the existing battle mode clearly labeled as approximate until then. Never silently fall back from native to a different rules engine in a ranked or online match.

## Save integration

The integrated game persists *two compressed profiles inside one PENSAVE flash file*. The reader in `native-profile-reader.js` projects them read-only for the existing Dex UI. Slot 1 and Slot 2 maintain separate SaveBlock2 option bits and SaveBlock1 variables, including the randomizer mask. Each online team must be explicitly selected from a chosen profile rather than merging or overwriting those options.
