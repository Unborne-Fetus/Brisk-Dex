# Complete-game acceptance gates

Target: a faithful standalone Brisk Emerald campaign, including its postgame and custom systems. The current build is **not a complete game or a release candidate**. Converted map counts and effect-family coverage cannot establish story or battle parity.

Before removing the development label, every gate below needs repeatable evidence against the pinned ROM source and a real playthrough. A working test room does not satisfy a campaign gate.

| Gate | Current state | Required evidence |
|---|---|---|
| New game through Champion | Blocked | Fresh save completes all required story events, eight badges, Elite Four, Champion and credits without development travel |
| Story interpreter | Partial | Shared scripts, native specials, map-entry/frame/coordinate triggers, choices, battle continuations, NPC movement, object visibility and cutscene sequencing |
| Traversal | Partial | Every required map and exit, elevation rules, surfing/diving, HMs, bikes, Fly, map gates and softlock recovery |
| Battle parity | Partial | Source-verified scenarios covering moves, abilities, forms, held items, targeting, doubles, AI, difficulty and rewards |
| Pokémon and items | Partial | All species/forms, source sprites, exact learnsets/evolutions, gifts, encounters, shops, item effects and legality |
| Brisk systems | Unported or partial | Dynamax Adventures, contests, DexNav, followers, capsules/send-out text, overworld catching, trainer rematches and all remaining ROM options |
| Progression and economy | Partial | Caps, difficulty exceptions, money, EXP, trainer flags, quests and rewards match the ROM and survive saving |
| Postgame | Blocked | Postgame story, Orange Islands access/progression, custom encounters, legendaries and optional bosses complete normally |
| Save migration | Partial | Versioned native migrations, backups and recovery across releases; GBA conversion needs its own validated importer |
| Platforms and updates | Partial | Desktop/mobile builds, long sessions, supported input/storage, signed releases, asset updates and rollback |
| Existing Dex integration | Intentionally disconnected | Explicitly approved, tested native ownership/provenance protocol before enabling online/trade/save-backed operations |

## This pass

The interpreter now supports yes/no resumption, item checks/removal, money operations, Pokémon gifts, HealPlayerParty, sequential label fallthrough, bounded player movement tables and valid source warps. Transactions commit only after the executed path finishes and validates. Cancellation, unsupported commands, invalid destinations, overflow and stale state leave existing progress intact. Gift randomness commits exactly once, including when execution replays around several choices.

This is foundational progression work. It does not implement all native specials, cutscenes, scripted battles, coordinate triggers, or the entire opening sequence. The live app and online integrations remain disconnected.
