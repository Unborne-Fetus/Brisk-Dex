# Brisk Emerald native integration in Brisk Dex

This embeds the native C engine with Brisk Emerald game content imported from its pinned source repository. It replaces the separate executable selector and native game window. The game is a managed, hidden helper process inside one Brisk Dex desktop installation, rendering its 240×160 BGR555 frames into a canvas inside the app.

## One-app local build

On Windows, run `build-integrated.bat` from your Brisk Dex source checkout with WSL Ubuntu and Node.js 22+ installed. The wrapper checks compiler prerequisites and installs missing Debian/Ubuntu packages automatically (it may ask for your WSL password), before fetching or compiling source. Re-run the same command after a failed package download. This single build command checks out the pinned native backend, imports the pinned Brisk changes, compiles and stages the private internal runtime, runs desktop tests, and packages one Brisk Dex Windows installer. No player has to find or select a separate game executable. The result is for your own build and testing; do not publicly distribute game assets without the necessary rights.


Run `bash tools/build-native-expansion.sh windows` in Ubuntu/WSL (or `linux` on Linux), after installing the native upstream dependencies. The script pins the native backend to `bb3fd057061cdd7e6a9e79b76abb41924ee44ecc` and Brisk to the revision in `tools/brisk-native-source.json`. It imports Brisk changes relative to expansion 1.17.0, preserving native ABI guards, applies `tools/brisk-native-port.patch` and the embedded transport, then stages the private runtime under ignored `native-game/win32/` or `native-game/linux/`.

When `npm run dist:win` or `npm run dist:linux` is subsequently run locally, Electron Builder includes this staged engine in the app's internal resources. **End users install only Brisk Dex; they do not select or install an executable, and gameplay appears inside its game tab.** Technically the native game still runs as a private child process, but it never creates an SDL window or requires a separate launch.

By default public GitHub builds do **not** contain Nintendo game assets or a precompiled native engine; users of those builds will see the native game as unavailable. Do not publish a build containing proprietary assets unless you have appropriate redistribution rights. This is not a completed game release.

## Transport

The native game's headless video backend writes packets `BEXP` + little-endian length 76800 + 76800 bytes of raw BGR555 pixels on stdout. Brisk Dex decodes these with framing, renders using nearest-neighbor canvas scaling, and ignores malformed frames. The game's stdin takes little-endian 16-bit key masks (low ten bits, active-high), read by a dedicated SDL thread. Electron's IPC never permits the web page to pass an executable path or command line. Native Brisk saves live in Electron user-data `native-brisk-emerald/`. The earlier base-expansion native directory, `native-expansion/`, is preserved. GBA saves require conversion and are not loaded directly by the native engine.

The embedded bridge streams video and input. SDL plays native audio directly through the Windows/Linux audio device without opening a game window. Keyboard and onscreen controls cover all ten GBA buttons. Controller forwarding and save interchange are future work.

## Limitations / validation

CI compiles the complete Brisk port for Windows and Linux. The Linux replay passes the opening, custom nine-starter case, first battle, in-game saving, cold restart/Continue, and isolation of the two save profiles. The embedded frame transport, desktop bridge, standalone Dex, and Windows UI checks pass. A complete Hoenn/Kanto playthrough remains unverified. Native backend support is currently Windows and Linux only.

## Windows checkout / WSL line endings

If `build-integrated.bat` previously printed `set: pipefail: invalid option name`, the script was checked out with Windows CRLF line endings. The Windows build wrapper now normalizes its Bash input automatically, and `.gitattributes` keeps future `.sh` checkouts in LF format. Pull the latest version, then rerun `build-integrated.bat`; do not edit the game source or install an extra launcher. A WSL `Failed to start the systemd user session` warning is separate and may be nonfatal; if WSL itself fails to run commands, inspect `wsl --status` and the WSL distro health.

## Missing WSL compiler packages

The integrated Windows build now installs missing compiler packages automatically, including `gcc-multilib`, `libc6-dev-i386`, `gcc-mingw-w64-x86-64`, `binutils-mingw-w64-x86-64`, and `clang`. Standalone Bash builds only check dependencies; use `bash tools/setup-native-deps.sh windows --install` to install them, or pass `--install` as the second argument to `build-native-expansion.sh`. Package-manager failures stop the build before any clone or packaging.

Under WSL, source and object files live in `~/.cache/brisk-dex/<checkout-key>/brisk-emerald-native` (or `$XDG_CACHE_HOME`). This avoids building on Windows NTFS. Only the final executable and SDL2 DLL are copied into the app checkout for packaging. `BRISK_NATIVE_SOURCE_DIR` can override the source location. Existing `native-src` checkouts are left untouched. Fresh clones omit the upstream Git history; repeat builds reuse the pinned source and compiled objects.

## Older WSL MinGW compilers

Some older MinGW GCC versions reject C99 `%zu`/`%zx` formats in standard stdio calls even with ANSI stdio enabled. The build applies a platform-only adapter that explicitly selects MinGW's GNU-format stdio functions. Format checking and warnings-as-errors remain enabled. The Windows native build is checked on both Ubuntu 22.04 and 24.04. Host `libsdl2-dev` is required for the Windows build's Linux data-layout submake and is now checked for both targets.

`build-integrated.bat` records console output in `build-integrated.log` beside the batch file, including failures. Rerunning the build keeps the cached source and objects; no manual source cleanup is needed.

Windows builds run the upstream COFF converter tests and real-object comparisons. macOS-only assembler tests are excluded from Windows builds so older Clang releases do not need to understand Mach-O zero-fill sections. Linux and other upstream build modes keep their original test selection.

The Windows target explicitly sets `WINVER` and `_WIN32_WINNT` to Windows 10 so older MinGW headers expose the required host APIs. The build compiles the Windows platform library before converting game assets, reporting compiler failures earlier.

## Import-section layout across binutils versions

Some MinGW linker versions emit a read-only `.idata` section after writable game data, which the native engine's contiguous writable-image check rejects. Before validation, the Windows link recipe now makes that import section writable when it lies within the mutable tail, and updates the PE checksum. Section addresses, import tables and contents remain in place. The full upstream PE layout validator still runs afterward. CI recreates the reported read-only flag on the real built engine, verifies rejection, applies normalization, and verifies the complete image again.

## Source import and native adaptations

`tools/prepare_brisk_native.py` applies all 4,368 Brisk-changed files at the current pin, merging 54 overlapping files and resolving nine explicitly reviewed conflicts. Unknown conflicts abort the build. Assets come directly from their source repository. The importer works with older Git versions through `git merge-file` and is repeatable on the dedicated source cache.

The Brisk native profile moves `gHeap` outside the emulated EWRAM window, sets it to 16 MiB, widens allocation size fields, preserves 8-byte alignment, and gives the compact save data its own layout identifier. The previous base game's cross-width save converter does not apply to this different schema. `build-info.json` identifies the staged game so the app chooses the correct save directory.

The native port also corrects Route 101 rescue triggers that were outside the pinned Brisk map, retaining its relocated bag and nine-starter case. The custom starter case and stat editor yield between graphics-setup frames so host DMA can complete. Battle type icons guard the absence of an Illusion Pokémon, and battle speed control handles the final frame after battle resources are released.

The native symbol map is staged beside the executable for diagnostics and state-based replay validation. CI builds both Windows and Linux Brisk engines and exercises the opening, first battle, saving, restarting and profile selection. See [capacity and remaining limits](BRISK_NATIVE_CAPACITY.md).

For backend development, `BRISK_NATIVE_PROFILE=expansion bash tools/build-native-expansion.sh linux` retains the base-expansion profile. The integrated Windows installer entrypoint always selects Brisk.
