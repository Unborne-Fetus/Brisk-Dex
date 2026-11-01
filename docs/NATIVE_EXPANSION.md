# Embedded native expansion in Brisk Dex (experimental)

This implements an embedded **viewport and input transport** for the real pokeemerald-expansion native engine. It replaces the separate executable selector and native game window. The game is a managed, hidden helper process inside one Brisk Dex desktop installation, rendering its 240×160 BGR555 frames into a canvas inside the app.

## One-app local build

On Windows, run `build-integrated.bat` from your Brisk Dex source checkout after installing the native compiler prerequisites in WSL/Ubuntu. This single build command checks out the pinned expansion source, compiles and stages the private internal runtime, runs desktop tests, and packages one Brisk Dex Windows installer. No player has to find or select a separate game executable. The result is for your own build and testing; do not publicly distribute game assets without the necessary rights.


Run `bash tools/build-native-expansion.sh windows` in Ubuntu/WSL (or `linux` on Linux), after installing the native upstream dependencies. The script pins upstream to `bb3fd057061cdd7e6a9e79b76abb41924ee44ecc` (expansion `1.17.1`), applies `tools/patch-native-stream.py` to two platform modules and stages the built helper under ignored `native-game/win32/` or `native-game/linux/`.

When `npm run dist:win` or `npm run dist:linux` is subsequently run locally, Electron Builder includes this staged engine in the app's internal resources. **End users install only Brisk Dex; they do not select or install an executable, and gameplay appears inside its game tab.** Technically the native game still runs as a private child process, but it never creates an SDL window or requires a separate launch.

By default public GitHub builds do **not** contain Nintendo game assets or a precompiled native engine; users of those builds will see the native game as unavailable. Do not publish a build containing proprietary assets unless you have appropriate redistribution rights. This is not a completed game release.

## Transport

The native game's headless video backend writes packets `BEXP` + little-endian length 76800 + 76800 bytes of raw BGR555 pixels on stdout. Brisk Dex decodes these with framing, renders using nearest-neighbor canvas scaling, and ignores malformed frames. The game's stdin takes little-endian 16-bit key masks (low ten bits, active-high), read by a dedicated SDL thread. Electron's IPC never permits the web page to pass an executable path or command line. Game saves live in Electron user-data `native-expansion/` and do not overwrite Brisk Emerald GBA saves.

The embedded bridge currently streams video and input only. Native audio is deliberately muted until a stable PCM transport exists. Controls support keyboard and onscreen buttons; controller forwarding and save interchange are future work.

## Limitations / validation

The JavaScript launcher, IPC framing, and build patch are regression-tested. **The patched expansion C source has not yet been compiled or run through a native game-play smoke test in this environment**, so this feature must be regarded as experimental. This still runs unmodified expansion gameplay; Brisk-specific content has not yet been ported. Native backend support is currently Windows and Linux only.

## Windows checkout / WSL line endings

If `build-integrated.bat` previously printed `set: pipefail: invalid option name`, the script was checked out with Windows CRLF line endings. The Windows build wrapper now normalizes its Bash input automatically, and `.gitattributes` keeps future `.sh` checkouts in LF format. Pull the latest version, then rerun `build-integrated.bat`; do not edit the game source or install an extra launcher. A WSL `Failed to start the systemd user session` warning is separate and may be nonfatal; if WSL itself fails to run commands, inspect `wsl --status` and the WSL distro health.
