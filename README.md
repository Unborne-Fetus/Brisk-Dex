# Adapt Dex

Adapt Dex is a Generation 1–3 Pokémon ROM-hack companion for Game Boy, Game Boy Color and Game Boy Advance games. Choose a local ROM (and optionally a save) to browse available Pokémon, moves, maps and other game data. Adapt Dex does not include game ROMs.

Reference information comes from verified ROM tables or an optional source-matched index. Brisk Emerald's exported artwork and metadata are bundled as a reference for that game; Adapt Dex keeps selected ROM data isolated from other hacks.

## Features

**Compatibility edition (Generation 1–3):** competitive sets, online battles, trading and the relay service are not included. The app imports GB/GBC and GBA cartridges, but the save editor remains Generation 3 only. Unfamiliar GB/GBC saves are inspected read-only and never interpreted as Emerald saves.

- **Pokédex:** search Pokémon and forms, inspect stats and evolutions, look up encounters, view sprites, and play cries. Track None, Seen, Caught, and Shiny status from a save, with manual overrides.
- **Reference tabs:** browse moves, abilities, items, locations, and trainer teams.
- **Save management:** inspect your party and PC boxes, move Pokémon into external storage, and edit supported Pokémon details.
- **External Pokémon storage:** keep a collection independent of one save, search and sort it, and export or merge portable JSON archives.
- **Bag storage:** move existing item stacks between the game Bag and external storage, choosing the quantity to transfer. Key items stay in the game.
- **Settings:** light/dark mode, zoom, and eight language choices.
- **Guides:** player instructions inside the app.

## Install and play

Players installing a packaged app do not need Node.js or npm.

| Platform | Package | Notes |
| --- | --- | --- |
| Web | Browser app | Runs from GitHub Pages; choose ROM/save files locally. |
| Windows | EXE installer | Run the installer, then launch Adapt Dex. |
| Android | APK | Transfer it to your device and install it. Android may ask you to allow installation from that source. |
| iOS | Unsigned IPA | Requires signing before installation; it is not a ready-to-install App Store package. |
| Linux | AppImage or DEB | Available through the separate Linux build workflow. |
| macOS | DMG | Build locally on a Mac using the commands below. |

Download packages from a successful [Adapt Dex release workflow](https://github.com/Unborne-Fetus/Brisk-Dex/actions/workflows/release-adapt.yml). It builds Windows, Android, Linux, macOS and unsigned iOS packages. Extract the downloaded ZIP to get the installer.

### Web version

Adapt Dex Web is a static browser build from the `adapt-dex` branch. After a successful [web deployment workflow](https://github.com/Unborne-Fetus/Brisk-Dex/actions/workflows/deploy-adapt-web.yml) and Pages setup, it is served at [Adapt Dex Web](https://unborne-fetus.github.io/Brisk-Dex/).

- Select a local `.gb`, `.gbc` or `.gba` ROM, or paste a public GitHub repository URL, raw ROM file, release download URL, or compatible Adapt Dex JSON index.
- When loading a GitHub repository, Adapt Dex checks for a compatible reference index and then for a single compiled ROM in its latest release. Source-only or patch-only repositories cannot automatically be converted into a game in the browser.
- ROM files downloaded from GitHub are inspected locally. Some GitHub release downloads may be blocked by browser CORS; download the file separately and select it locally if so. Adapt Dex does not upload ROMs or saves to its website.
- A GitHub reference index alone cannot be used to inspect or edit a save; choose the matching game ROM for save handling.
- Save editing is enabled only for verified layouts; browser changes must be **exported as a save copy** to be used by your emulator. Recovery snapshots use browser storage, which can be cleared. Back up your originals.
- External Pokémon storage is stored in your browser and can be exported separately. Incognito sessions may discard it.
- For offline hosting or deployment elsewhere, download the **Adapt-Dex-Web-Site** artifact from the successful workflow and serve its contents as static files.
- If GitHub Pages publishing is blocked, set **Settings → Pages → Build and deployment → Source: GitHub Actions**. A repository owner may also need to allow `adapt-dex` to deploy to the `adapt-dex-pages` environment.
- Local preview: run `npm run web:build`, then `python -m http.server --directory web-dist 8000` and open `http://localhost:8000`.

### First launch (adapt-dex)

1. Open Adapt Dex. The initial screen asks for a **Game ROM (.gb, .gbc or .gba)** and an **optional save (.sav or .srm)**.
2. Choose a ROM. Optionally choose the save that belongs to the same game, then press **Enter Adapt Dex**.
3. Adapt Dex imports verified ROM data locally and opens the Pokédex, moves, abilities, trainers and encounters where recognized. Without a save, you can browse the ROM but player party, storage and progress aren't available.
4. If a save is included, Adapt Dex displays its party and boxes and follows the chosen save profile's write-safety rules. Use **Change game** to return to the chooser (this reloads the app).

Ordinary GB/GBC cartridges can expose verified name tables, while maps, trainers, sprite compression and synthesized cries generally require source-matched reference data. Gen 1 uses internal species numbering; do not assume National Pokédex IDs. The Emerald-based Gen 3 extractor can expose more tables. Normal ROMs may expose only some tables; a source-indexed GBA ROM carries more game-specific data. SHA-256 ROM verification and remembered save associations catch accidental mismatches, but an unknown save's origin cannot be proven from its structure alone. Edits still require a trusted profile.

The compatibility app asks for a ROM every time it launches and does not silently reopen an earlier save. Bundled reference assets remain available for Brisk-specific tools, but the selected ROM replaces the displayed game reference data for the session.

Keep a separate copy of your save and export your external storage periodically. Close the game/emulator before editing its save so the emulator does not overwrite your changes.

## Autosave and external storage

Changes save automatically; there is no separate confirmation step for every edit.

| Version | How save changes are stored |
| --- | --- |
| Desktop | Writes to the opened save file and makes timestamped backups beside it. |
| Android | Writes to the selected document when its access permission is available, with a recovery backup in app storage. |
| Browser / iOS fallback | Keeps a recovery copy internally. Use **Export saved copy** to put the updated save back into your emulator. |

Reopening a save depends on the original file still being available and the app retaining access. A browser recovery copy is specific to that browser and site; clearing its data can remove it.

External storage is separate from the game save. Export it before uninstalling the app, clearing app data, or changing devices. Desktop Pokémon storage is stored as `briskdex-storage.json` in the app's user-data directory.

Item transfers use items already present in the Bag or external storage. Transfers must fit the game's pocket and stack limits. Important key items cannot be moved into external storage.

## Languages and offline use

Settings includes **English, Spanish, Italian, French, Russian, Japanese, Mandarin Chinese, and Arabic**. Arabic uses right-to-left layout.

English and bundled reference data work offline. Other languages use an online translation service for uncached text; previously cached translations remain available offline. Service limits or connection failures can leave some text in English. These are automatic translations, not fully reviewed translation packs.

Building and downloading app packages needs internet access. ROM inspection itself is local.

## Build files

There are two Windows launchers in the repository root:

- **`build.bat`** builds the **Windows installer (.exe)** and **Android APK (.apk)** locally on the Windows PC.
- **`build-all.bat`** builds **Windows, Android, Linux, macOS, and iOS** without GitHub Actions.

Both place finished release files in `dist`.

### build.bat — Windows + Android

Double-click `build.bat`. It runs the compatibility release checks, builds the Windows installer, prepares the Android project, builds the APK, and copies the APK to `dist/Brisk-Dex-Android.apk`.

This path requires Node.js, Java 21, and the Android SDK.

### build-all.bat — every platform

Double-click `build-all.bat`.

It builds every target from the same clean committed `adapt-dex` revision:

1. Windows EXE and Android APK on the Windows PC.
2. Linux AppImage and DEB through WSL.
3. macOS DMG and an unsigned iOS IPA on a Mac over SSH.

Windows cannot natively compile macOS or iOS applications, so the Apple stage needs access to a Mac with Xcode and SSH enabled. If `BRISK_MAC_HOST` is not already set, the script asks for the Mac SSH target, for example `username@192.168.1.50`.

You may optionally set:

```bat
setx BRISK_MAC_HOST "username@192.168.1.50"
setx BRISK_MAC_BUILD_DIR "~/BriskDexBuild"
```

Open a new terminal after using `setx`. The Mac needs Node.js 22+, npm, Xcode, the Xcode command-line tools, SSH access, `unzip`, and `zip`.

The iOS output is an **unsigned IPA**. Signing/installing it is a separate step.

## Run or build locally

Use Node.js **22 or newer** and run these commands from the repository folder:

```bash
npm ci
npm start
```

To build a desktop installer:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Choose the command for your platform. macOS packaging requires a Mac. Linux produces an AppImage and DEB. Outputs go into `dist`.

In Windows PowerShell, use **npm.cmd** in place of **npm** if you get “running scripts is disabled”:

```powershell
npm.cmd ci
npm.cmd start
```

Android local builds require Java and the Android SDK. iOS compilation requires macOS and Xcode; `npm run ios:build` prepares and syncs the project rather than producing an IPA by itself. The combined GitHub workflow handles native compilation and IPA packaging.

The browser interface is `index.html`. Serve the complete app folder through a local web server so its JSON and graphics can load; copying only the HTML file is not enough. Browser hosting requires the complete static asset bundle.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| PowerShell blocks npm.ps1 | Run `npm.cmd` instead. |
| build.bat reports a missing PowerShell file | Pull or extract the entire repository, including `tools/build_all.ps1`. |
| One platform build fails | Read the failed step printed in the build window. `build.bat` covers Windows/Android; `build-all.bat` also reports whether WSL/Linux or the remote Mac/Apple stage failed. |
| Save changes are not in the emulator | On browser/iOS fallback, export the updated save and replace the emulator's copy. Also check that the emulator did not overwrite it. |
| Some translated text stays English | Connect to the internet; uncached translations depend on service availability and limits. |

## Build a compatible indexed ROM

For a compiled Emerald-based `.gba` and its matching source checkout:

```sh
python tools/build_compat_rom.py --rom /path/to/game.gba --source /path/to/source --output /path/to/game-indexed.gba
```

This can include custom regions, Fakémon, items, trainers, maps, icons, shiny battle sprites and cries. Use `--no-art` if the art collection exceeds the ROM index budget. The original ROM remains untouched.

**External Pokémon storage and external item storage are retained.** They are independent of the removed trading, online battles and competitive systems. Keep archive backups when switching devices or clearing app data. Depositing or withdrawing Pokémon into a save still requires a trusted matching compatibility profile.
## Updating Brisk reference data

For contributors changing the ROM's data, run the extractor from the Adapt Dex folder against a Brisk Emerald checkout:

```bash
python3 -m pip install Pillow
python3 tools/extract_data.py /path/to/Pokemon-Brisk-Emerald
```

Commit the regenerated data and graphics, then rebuild the app. The extractor reads the ROM source; it does not substitute official-game stats for Brisk's changes.

## Local release builds

There are two Windows entry points:

- `build.bat` builds the **Windows installer (.exe)** and **Android APK (.apk)** into `dist/`.
- `build-all.bat` builds **Windows, Android, Linux, macOS, and iOS** from the same committed `adapt-dex` source.

`build-all.bat` uses WSL for the Linux AppImage/DEB and an SSH-accessible Mac for the macOS DMG and unsigned iOS IPA. Configure the Mac once with:

```bat
setx BRISK_MAC_HOST "username@your-mac-address"
```

The Mac needs SSH enabled, Node.js 22+, npm, Xcode, and Xcode command-line tools. An alternate remote build folder can be set with `BRISK_MAC_BUILD_DIR`; otherwise `~/BriskDexBuild` is used.

All completed artifacts are copied into `dist/`.

## GBA ROM importer

On `adapt-dex`, open **Settings → Import game from .gba ROM**. This imports reference data locally without touching your save. The importer recovers ROM headers, recognizable Pokémon names/stats and icons where layouts permit. For a complete dataset (including trainer teams, Fakémon, new routes, items and normal/shiny icons), embed a source-matched index in a new `.gba` with `npm run rom:index -- game.gba`; see [ROM import instructions](compatibility/ROM_IMPORT.md). Unsupported fields are reported, not guessed.

## Emerald compatibility build

The `adapt-dex` release adds profile-based support for standard Pokémon Emerald saves and Emerald-derived ROM hacks while preserving Brisk Emerald's expanded format.

- Unknown Emerald-derived saves open read-only unless a trusted profile is selected.
- Compatibility packs can define save offsets, checksums, PC layouts, Bag layouts, Pokédex storage, Pokémon field encoding, ID maps, and fingerprints.
- Cross-profile Pokémon transfers require compatible ID namespaces or explicit mappings.
- Save writes keep an untouched backup and run checksum + round-trip validation before touching the original file.
- Compatibility pack documentation and schema live in `compatibility/`.

Release validation commands:

```bash
npm run release:test
npm run android:prepare
node tools/verify_release.js --mobile
```

## License and credits

Adapt Dex's original source code is licensed under the **PolyForm Noncommercial License 1.0.0**. Study, modification, and redistribution are permitted for noncommercial purposes under its terms. Commercial use, including selling copies or derivative versions, is not permitted. See [LICENSE](LICENSE) for the complete terms.

### Project, game-data, and engine credits

- **Pokémon Brisk Emerald** supplies Adapt Dex's species, form, move, ability, item, encounter, trainer, sprite, cry, and save-format reference data.
- **ROM Hacking Hideout / pokeemerald-expansion contributors** created and maintain the engine Brisk Emerald is built on. Brisk Emerald currently tracks the 1.17.x expansion line.
- **pret / pokeemerald contributors** created the Pokémon Emerald decompilation that pokeemerald-expansion and Brisk Emerald ultimately build from.
- The many additional programmers, researchers, data contributors, artists, testers, and documentation writers credited by Brisk Emerald and pokeemerald-expansion remain credited for the systems and material inherited through those projects. See Brisk Emerald's `CREDITS.md` for the full upstream contributor list.

### Imported art and resource credits

Some graphics displayed by Adapt Dex are extracted from Brisk Emerald, so the original creators of those resources are also part of Adapt Dex's credit chain.

- **Team Aqua's Asset Repo** and its contributors for imported community resources used by Brisk Emerald.
- **PurrfectDoodle (Eva)**, **RavePossum**, **Ruki**, and **LeoB (leob0505)** for battle-background work and related source material used in Brisk Emerald.
- **Coffee Cup** for trainer-customization source resources.
- **FM**, **Zeikaro**, and **Rahtak** for greenery resources and ports.
- **KyuZee** for fence resources.
- **Oomer** for plant and decoration resources.
- **yoshord** for Secret Base furniture resources.
- **Horo** (commissioned by Paccy), **Kasen**, **spilledpizza**, **TheWiggliestJiggliest**, **RichardPT**, **robloxmaster376**, **The Spriters Resource**, and **The Radiant Quartz / Prismatic Platinum team** for visiting-Champion overworld sprite material credited in Brisk Emerald.
- Additional tileset and asset authors are preserved in Brisk Emerald under `resources/team_aqua` and its `CREDITS.md`; those per-pack credits and permissions still apply when their work appears in Adapt Dex.

### App, build, and service credits

Adapt Dex is built with open-source tooling and services maintained by their respective creators and communities:

- **Electron** for the desktop application runtime.
- **electron-builder** for desktop packaging.
- **Ionic / Capacitor** for Android and iOS packaging and native bridges.
- **esbuild**, created by Evan Wallace, for JavaScript build tooling.
- **Pillow** and its contributors for image processing used by the Brisk data/asset extraction tools.
- **MyMemory Translation API** for optional online translation of uncached non-English interface text.
- **GitHub Actions** and **GitHub CLI** for the project's automated multi-platform build workflow.

### Pokémon ownership

Pokémon names, characters, graphics, game data, trademarks, and other official third-party material remain the property of **Nintendo, Creatures Inc., and GAME FREAK inc.** and are not licensed by this notice. Adapt Dex is a non-commercial fan project and is not affiliated with or endorsed by those companies.

### Development assistance

Adapt Dex was originally made with Claude-assisted coding, with subsequent development and fixes assisted by OpenAI Codex/ChatGPT.

If a third-party system, asset pack, or contributor has been unintentionally omitted, that credit should be added rather than removed from the original source material.
