# Brisk Dex

Brisk Dex is a companion app for [Pokémon Brisk Emerald](https://github.com/Unborne-Fetus/Pokemon-Brisk-Emerald). Browse the game's reference data, manage Pokémon and items across saves, and battle another player using Pokémon from your collection.

Species, forms, stats, moves, abilities, items, encounters, and trainer teams come from Brisk Emerald's source. Brisk changes many things from the official games, so its bundled data is the reference used by this app.

## Features

- **Pokédex:** search Pokémon and forms, inspect stats and evolutions, look up encounters, view sprites, and play cries. Track None, Seen, Caught, and Shiny status from a save, with manual overrides.
- **Reference tabs:** browse moves, abilities, items, locations, and trainer teams, plus competitive set suggestions.
- **Save management:** inspect your party and PC boxes, move Pokémon into external storage, and edit supported Pokémon details.
- **External Pokémon storage:** keep a collection independent of one save, search and sort it, and export or merge portable JSON archives.
- **Bag storage:** move existing item stacks between the game Bag and external storage, choosing the quantity to transfer. Key items stay in the game.
- **Online Battle:** host or join a private singles battle with up to six Pokémon selected from your party, PC boxes, or external storage.
- **Settings:** light/dark mode, zoom, and eight language choices.
- **Guides:** player instructions inside the app.

## Install and play

Players installing a packaged app do not need Node.js or npm.

| Platform | Package | Notes |
| --- | --- | --- |
| Windows | EXE installer | Run the installer, then launch Brisk Dex. |
| Android | APK | Transfer it to your device and install it. Android may ask you to allow installation from that source. |
| iOS | Unsigned IPA | Requires signing before installation; it is not a ready-to-install App Store package. |
| Linux | AppImage or DEB | Available through the separate Linux build workflow. |
| macOS | DMG | Build locally on a Mac using the commands below. |

Download packages from a successful run in the repository's [Actions tab](https://github.com/Unborne-Fetus/Brisk-Dex/actions). The combined workflow provides **Brisk-Dex-Windows**, **Brisk-Dex-Android**, and **Brisk-Dex-iOS-Unsigned** artifacts. Extract the downloaded ZIP to get the installer.

### First launch

1. Open your Brisk Emerald save file.
2. Check the trainer, party, boxes, and Bag before making changes.
3. Use the reference tabs or Guides as needed.

Bundled game data and graphics load automatically. The app also attempts to reopen your last-used save when launched.

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

Multiplayer needs a connection to the relay. Building and downloading app packages also needs internet access.

## Build files

There are two Windows launchers in the repository root:

- **`build.bat`** builds the **Windows installer (.exe)** and **Android APK (.apk)** locally on the Windows PC.
- **`build-all.bat`** builds **Windows, Android, Linux, macOS, and iOS** without GitHub Actions.

Both place finished release files in `dist`.

### build.bat — Windows + Android

Double-click `build.bat`. It runs the release checks, builds the Windows installer, prepares the Android project, builds the APK, and copies the APK to `dist/Brisk-Dex-Android.apk`.

This path requires Node.js, Java 21, and the Android SDK.

### build-all.bat — every platform

Double-click `build-all.bat`.

It builds:

1. Windows EXE and Android APK on the Windows PC.
2. Linux AppImage and DEB through WSL.
3. macOS DMG and an unsigned iOS IPA on a Mac over SSH.

Windows cannot natively compile macOS or iOS applications, so the Apple stage needs access to a Mac with Xcode and SSH enabled. If `BRISK_MAC_HOST` is not already set, `build-all.bat` asks for the Mac SSH target, for example `username@192.168.1.50`.

You may optionally set:

```bat
setx BRISK_MAC_HOST "username@192.168.1.50"
setx BRISK_MAC_PATH "~/Brisk-Dex-build"
```

Open a new terminal after using `setx`. The Mac needs Node.js, npm, Xcode command-line tools, and permission to accept SSH connections.

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

The browser interface is `index.html`. Serve the complete app folder through a local web server so its JSON and graphics can load; copying only the HTML file is not enough. Browser hosting does not start a battle relay automatically.

## Multiplayer: PC and Android on the same network

Use the latest build on both devices.

1. Connect the PC and Android device to the same Wi-Fi/LAN.
2. On the PC, open **Online Battle**, choose your team, and set **Battle relay URL** to `http://localhost:8787`.
3. Click **Host Battle**. The desktop app starts a local relay when needed and creates a six-character room code.
4. Allow Brisk Dex through Windows Firewall on **private networks** if prompted.
5. On Android, enter the PC's network relay address, then enter the generated room code and click **Join Battle**.
6. Both players mark themselves ready to begin.

For example, if the PC's IPv4 address is `192.168.1.50`, Android uses:

```text
http://192.168.1.50:8787
```

To find that address, run `ipconfig` on Windows and look under the active Wi-Fi or Ethernet adapter. Use its **IPv4 Address**, not a disconnected adapter or WSL virtual adapter.

**localhost means the device you are currently using.** Entering localhost on Android will not connect to your PC.

### Start a relay manually

For browser testing or builds without automatic hosting, leave this running in a terminal:

```powershell
npm.cmd run battle-server
```

The relay listens on port **8787** by default. To check it on the host PC, open:

```text
http://localhost:8787/health
```

A working relay returns JSON containing `"ok":true`. Check the same endpoint from Android using the PC's IPv4 address. If it works on PC but not Android, check the firewall and whether the network isolates devices, such as on guest Wi-Fi.

### Play across different networks

Both players need to reach the **same publicly accessible relay**, preferably through HTTPS. A local Wi-Fi address does not provide internet hosting on its own. Run `battle-server.js` on a reachable server and enter its relay URL on both devices.

Rooms live in relay memory and are lost when it restarts. They expire after six hours of inactivity. Session tokens can reconnect a refreshed page while the room still exists.

### Battle engine scope

The relay resolves battles on the server, including turn order, damage, RNG, switching, status, field effects, and supported gimmicks. Teams can use Pokémon from the loaded save or external storage.

The engine's effect-family coverage check accounts for all families in its generated Brisk move manifest. **Effect-family coverage is not proof of exact parity with every ROM mechanic or interaction.** PC-to-Android connectivity and complex battle interactions still need device and gameplay testing.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Host Battle appears to do nothing | Check the connection status beside the buttons and any error at the top of the page. Verify the relay health endpoint. |
| Android cannot join | Use the PC's IPv4 address, the correct six-character code, the same network, and a private-network firewall allowance. |
| Instructions still say to start the relay manually | You may be running an older installed build. Rebuild and install the new EXE/APK. |
| PowerShell blocks npm.ps1 | Run `npm.cmd` instead. |
| build.bat reports a missing PowerShell file | Pull or extract the entire repository, including `tools/build_all.ps1`. |
| One platform build fails | Open the run URL printed by the script and inspect that platform's failed step. Successful platform artifacts may still be available. |
| Save changes are not in the emulator | On browser/iOS fallback, export the updated save and replace the emulator's copy. Also check that the emulator did not overwrite it. |
| Some translated text stays English | Connect to the internet; uncached translations depend on service availability and limits. |

## Updating Brisk reference data

For contributors changing the ROM's data, run the extractor from the Brisk Dex folder against a Brisk Emerald checkout:

```bash
python3 -m pip install Pillow
python3 tools/extract_data.py /path/to/Pokemon-Brisk-Emerald
```

Commit the regenerated data and graphics, then rebuild the app. The extractor reads the ROM source; it does not substitute official-game stats for Brisk's changes.

Useful battle checks:

```bash
npm run battle:coverage
npm run battle:smoke
```

## License and credits

Brisk Dex's original source code is licensed under the **PolyForm Noncommercial License 1.0.0**. Study, modification, and redistribution are permitted for noncommercial purposes under its terms. Commercial use, including selling copies or derivative versions, is not permitted. See [LICENSE](LICENSE) for the complete terms.

### Project, game-data, and engine credits

- **Pokémon Brisk Emerald** supplies Brisk Dex's species, form, move, ability, item, encounter, trainer, sprite, cry, and save-format reference data.
- **ROM Hacking Hideout / pokeemerald-expansion contributors** created and maintain the engine Brisk Emerald is built on. Brisk Emerald currently tracks the 1.17.x expansion line.
- **pret / pokeemerald contributors** created the Pokémon Emerald decompilation that pokeemerald-expansion and Brisk Emerald ultimately build from.
- The many additional programmers, researchers, data contributors, artists, testers, and documentation writers credited by Brisk Emerald and pokeemerald-expansion remain credited for the systems and material inherited through those projects. See Brisk Emerald's `CREDITS.md` for the full upstream contributor list.

### Imported art and resource credits

Some graphics displayed by Brisk Dex are extracted from Brisk Emerald, so the original creators of those resources are also part of Brisk Dex's credit chain.

- **Team Aqua's Asset Repo** and its contributors for imported community resources used by Brisk Emerald.
- **PurrfectDoodle (Eva)**, **RavePossum**, **Ruki**, and **LeoB (leob0505)** for battle-background work and related source material used in Brisk Emerald.
- **Coffee Cup** for trainer-customization source resources.
- **FM**, **Zeikaro**, and **Rahtak** for greenery resources and ports.
- **KyuZee** for fence resources.
- **Oomer** for plant and decoration resources.
- **yoshord** for Secret Base furniture resources.
- **Horo** (commissioned by Paccy), **Kasen**, **spilledpizza**, **TheWiggliestJiggliest**, **RichardPT**, **robloxmaster376**, **The Spriters Resource**, and **The Radiant Quartz / Prismatic Platinum team** for visiting-Champion overworld sprite material credited in Brisk Emerald.
- Additional tileset and asset authors are preserved in Brisk Emerald under `resources/team_aqua` and its `CREDITS.md`; those per-pack credits and permissions still apply when their work appears in Brisk Dex.

### App, build, and service credits

Brisk Dex is built with open-source tooling and services maintained by their respective creators and communities:

- **Electron** for the desktop application runtime.
- **electron-builder** for desktop packaging.
- **Ionic / Capacitor** for Android and iOS packaging and native bridges.
- **esbuild**, created by Evan Wallace, for JavaScript build tooling.
- **Pillow** and its contributors for image processing used by the Brisk data/asset extraction tools.
- **MyMemory Translation API** for optional online translation of uncached non-English interface text.
- **GitHub Actions** and **GitHub CLI** for the project's automated multi-platform build workflow.

### Pokémon ownership

Pokémon names, characters, graphics, game data, trademarks, and other official third-party material remain the property of **Nintendo, Creatures Inc., and GAME FREAK inc.** and are not licensed by this notice. Brisk Dex is a non-commercial fan project and is not affiliated with or endorsed by those companies.

### Development assistance

Brisk Dex was originally made with Claude-assisted coding, with subsequent development and fixes assisted by OpenAI Codex/ChatGPT.

If a third-party system, asset pack, or contributor has been unintentionally omitted, that credit should be added rather than removed from the original source material.
