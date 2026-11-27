# Brisk Dex changelog

This file summarizes player-facing changes and significant engineering updates to Brisk Dex. Dates refer to source changes on the default branch, not necessarily publication dates. The current desktop package version is **1.3.0**; Android build codes and platform releases are tracked separately. Changes under Unreleased are present in source but are not a claim that a new installer has been published or fully playtested.

- [Downloads and release notes](https://github.com/Unborne-Fetus/Brisk-Dex/releases)
- [Build and publication status](https://github.com/Unborne-Fetus/Brisk-Dex/actions)
- [Brisk Emerald's game feature guide](https://github.com/Unborne-Fetus/Pokemon-Brisk-Emerald/blob/master/BRISKFEATURES.md)

## Unreleased — source snapshot, November 26, 2026

Baseline reviewed: [921e85c](https://github.com/Unborne-Fetus/Brisk-Dex/commit/921e85ce64141992a5bf82579e9fd7bdda8653bd).

### Brisk Emerald data and compatibility

- Updated bundled species, forms, stats, moves, abilities, items, encounters, trainer teams and trainer flags to the current imported Brisk Emerald data revision.
- Latest bundled reference data and native source pin at the time of this review both target Brisk Emerald commit [fa74da7](https://github.com/Unborne-Fetus/Pokemon-Brisk-Emerald/commit/fa74da7a08ac7c83d2b866010eb079c3d2956056). See [data revision](brisk-emerald-data-revision.txt) and [native source pin](tools/brisk-native-source.json).
- Corrected synchronization of Team Xiphos Aegis trainer IDs and their Kanto region labels, including trainer flags outside legacy Kanto prefixes.
- Expanded synchronization coverage for new signature abilities and trainer data.
- Added Expert difficulty labeling in the trainer Dex without presenting Normal fallback rosters as exact Expert teams.
- Added guards to reject stale native game revisions before launching against newer companion data.

### Android — native engine integration

- Continued replacing companion-only game packaging with a real ARM64 native Brisk runtime. The source now contains actual game archive compilation and a strict integrated-APK validation path.
- Ported packed script pointers, field-effect pointers, sound keysplit tables, music jumps and saved Mystery Gift addresses for 64-bit execution.
- Corrected ARM64 game reset boundaries so native game memory is reset separately from host state.
- Corrected SDL/JNI entry-point handling, native archive symbol validation, duplicate assembly constants and relative relocations.
- Added regression coverage for native linking, relative music jumps, RELRO and conflicting assembly constants.
- Improved native-link and Gradle diagnostics, including retaining build logs and reporting remaining relocation errors instead of truncating them.
- Refreshes native Gradle inputs and SDL build cache; uses Java 21, dependency caching and retries for transient npm/Maven failures.

**Release status:** Android full-game packaging remains an integration and verification target. The latest source changes are not proof that the full APK has successfully compiled, contains a working `libbriskgame.so`, or runs through the game on a device. Companion-only previews must not be described as a playable integrated game. Distribution of native game assets also requires appropriate rights/approval.

Key changes: [native packaging](https://github.com/Unborne-Fetus/Brisk-Dex/commit/2173b26c969b14699c8cf6b846486d93aa086e5e), [ARM64 script pointers](https://github.com/Unborne-Fetus/Brisk-Dex/commit/8e863451422242abf923d9ae610ab597f38d5807), [reset boundaries](https://github.com/Unborne-Fetus/Brisk-Dex/commit/14d42b824383e3ea7eeca0040fb227a200cb9c9c).

### Windows / desktop

- Improved native shutdown handling and guarded late frame IPC after renderer destruction.
- Added checks to prevent a failed process termination from hanging Electron.
- Hardened updater path collision handling and reset stale rollback launch markers.
- Added first-frame hang detection while avoiding false freeze reports after pausing.
- Build and smoke-test the pinned native source before packaging integrated installers.
- Improved separation between public companion-only downloads and privately staged native-engine packages.

### Saves, stability and platform parity

- Hardened Android JNI lifecycle and background worker error handling.
- Added bounded Android save-picker reads to reduce memory-exhaustion risks.
- Recover interrupted native save-slot selection before starting the game; block concurrent transfers during recovery.
- Updated native opening replay tests to reflect Dex-managed save slots rather than the removed in-ROM slot menu.
- Added regression checks covering native source compatibility, Android startup recovery and desktop shutdown.
- APK builds are triggered on relevant app/content changes and successful source syncs.

Key changes: [source sync and runtime guards](https://github.com/Unborne-Fetus/Brisk-Dex/commit/a6f6b0ebf34cb7255ff49856564410ed7a033927), [save and release checks](https://github.com/Unborne-Fetus/Brisk-Dex/commit/7b08c3c37a7a518207eca9bd40992d46c15b6ec4), [Windows updater](https://github.com/Unborne-Fetus/Brisk-Dex/commit/a6d08cef16bb7b58d91f2073c678cfa156883c14).

### Update delivery and CI

- Android updater uses forward-only version codes and validates its signed update channel.
- Classifies certificate-chain failures and offers a secure browser fallback rather than weakening certificate validation.
- Pins the established Android signing certificate during CI and verifies signed output.
- Improved transient dependency retries and cancels stale integrated builds.
- Clearly labels companion previews separately from full-game packages.
- Added validation gates for native engine inclusion, revision parity and Android/desktop regression checks.

[Android signing and engine changes](https://github.com/Unborne-Fetus/Brisk-Dex/commit/bb85ae6ee2b58e06dca9905772f1751d32d64207)

## November 12, 2026 — capacity, crash fixes and updater

Source milestone; not a separate claimed semantic-version release.

### Added

- Native-only encounter table capacity of 64 walking and 32 surfing slots. Additional empty slots preserve existing encounter probabilities; this does not alter the original GBA ROM encounter limits.
- On-demand 30-slot external Pokémon storage boxes with no preset box-count maximum. Legacy flat archives remain import/export compatible; practical capacity is limited by available memory and storage.
- Android update instructions and installation confirmation in the interface.

### Fixed / improved

- Added 64-bit trainer-script pointer handling for post-May battle continuation.
- Updated the native source pin to incorporate follower and Rock Slide crash guards.
- Added regression tests for native script decoding and APK publication gates.
- Corrected Android updater version codes and signed-channel validation.
- A source commit records publication of an Android crash-fix test APK after successful CI; this is historical, not evidence that the latest integrated APK is available.

### Capacity limits still outstanding

- 10,000 species IDs and 10,000 DexNav entries require packed-record and save-format migrations.
- Unlimited in-game PC storage is not implemented; the native game retains 20 boxes.
- External companion storage is distinct from the in-game PC.

[Capacity plan](docs/NATIVE_10000_CAPACITY_PLAN.md) · [Capacity merge](https://github.com/Unborne-Fetus/Brisk-Dex/commit/25825f803a51278b1437a54d45b77186ebdefc2e) · [Trainer script repair](https://github.com/Unborne-Fetus/Brisk-Dex/commit/a0e8ac2f7fdf9abe41cce8c72c691dcb1ccb11c2) · [Test APK publication commit](https://github.com/Unborne-Fetus/Brisk-Dex/commit/1deb1f902ba557b9ef9a1e3a2bf3c779f6dd1f54)

## November 1–4, 2026 — embedded game and companion improvements

- Experimental embedded desktop game, with a managed native process, canvas framebuffer, native audio and keyboard/controller/touch input.
- Game-only fullscreen and standard controller input.
- Native save/clock backup and restore, independent save-profile inspection and validated read-only projections of integrated game data.
- Corrected Route 101 intro positions and facing directions in pinned game source.
- Added native crash and black-screen diagnostic export.
- Addressed May trainer battle crash and Pokémon Center VBlank deadlock; added regression coverage.
- Fixed Windows WSL integrated build handling, including CRLF scripts and project paths containing spaces.
- Improved Android updater manifest fetching and DNS-failure messaging.
- Restored Brisk Dex title and validated the Pages deployment path.

The historical compact two-profile implementation has since been superseded by the newer external save-profile direction; consult current save handling before importing or editing old saves.

[Native integration](docs/NATIVE_EXPANSION.md) · [Controller and save backup commit](https://github.com/Unborne-Fetus/Brisk-Dex/commit/a71814aa693c6ac2e94b5efd69c0e28dbd62a372) · [May/Center fix](https://github.com/Unborne-Fetus/Brisk-Dex/commit/34bddfe1a77b8acc0d70ca4926298ec682694d94)

## Existing companion features

For readers new to Brisk Dex, the established companion capabilities include:

- Searchable Pokémon and form reference, stats, evolutions, sprites, cries and encounter information.
- Moves, abilities, items, locations and trainer reference tables.
- Defeated-trainer tracking using save flags.
- Supported save inspection, party and PC browsing, Pokémon and item external storage, recovery backups, and export/merge of portable storage archives.
- Light/dark appearance, zoom, language settings and guides.
- Hosted web edition and optional self-contained offline HTML build. Browser editions retain recovery copies and require explicit export to transfer changes into emulator save files.
- Desktop and mobile packaging workflows; iOS unsigned builds require signing. Platform availability and the embedded game depend on actual successful builds.

See [README](README.md) for controls and platform-specific details. These are existing capabilities, not additions all introduced by the latest commit.

## Verification and known limitations

- This changelog was compiled from repository source, documentation and commit history. It does not certify a complete live playthrough or that every crash report has been resolved.
- Latest GitHub release assets and Actions conclusions could not be independently retrieved during this documentation update. Check the release and Actions links above for actual downloadable builds.
- The desktop package version remains 1.3.0; no version bump, new installer, APK publication or application UI change is implied by this documentation update.
- Native game saves and GBA saves are not automatically interchangeable. Back up both save profiles and external storage before migration.
- A companion-only APK/EXE is not a full native-game package. Full-game builds must pass engine inclusion, revision, signing (Android), launch and runtime checks.
- Future 10,000-species capacity and expanded in-game PC work remain explicitly incomplete.

