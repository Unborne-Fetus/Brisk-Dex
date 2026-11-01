# Native pokeemerald-expansion integration

This first milestone replaces Brisk Dex's JavaScript Emerald recreation with a local native engine launcher. Gameplay runs in a separate SDL2 window, rather than in the old browser iframe. This runs **unmodified expansion**, not Brisk Emerald's custom modifications.

## Reproducible source build

- Upstream: https://github.com/uehlbran/pokeemerald-expansion-native
- Pinned upstream revision: `bb3fd057061cdd7e6a9e79b76abb41924ee44ecc`, based on `expansion/1.17.1`.
- Upstream's MIT license is scoped to its platform-layer additions; original Emerald and expansion source/assets have their own provenance. Do not publish compiled game binaries or proprietary game assets.
- Install prerequisites documented in the upstream README. On Windows 10/11 open Ubuntu in WSL and run `bash tools/build-native-expansion.sh windows`; on Linux run `bash tools/build-native-expansion.sh linux`. The build is substantial and requires a working Linux compiler, SDL2, and upstream toolchain.
- The script checks out pinned source in ignored `native-src/pokeemerald-expansion-native/`. This is a detached checkout, so don't keep personal source changes in that checkout. You can set `BRISK_NATIVE_SOURCE_DIR` to a different location.
- Windows output: `native-src/pokeemerald-expansion-native/build/native64-windows/pokeemerald-native.exe`. Keep `SDL2.dll` beside it.
- Linux output: `native-src/pokeemerald-expansion-native/build/native64/pokeemerald-native`. Install the SDL2 runtime.
- In Brisk Dex desktop open **Native Emerald**, select the executable, and launch.

Brisk Dex does not automatically download or compile the native game when it launches, and packages no native game binaries or assets. This first milestone covers Windows and Linux; macOS, web and mobile native-game support is not implemented.

## Desktop integration and save boundaries

The Electron main process stores only the user-selected native executable path in app user data. It checks the expected executable basename, regular file, and Windows DLL, then spawns the binary directly without invoking a shell. The renderer cannot supply a new command or executable at launch time. Filename checks are **not** a security signature; build from a source you trust.

Native expansion uses its own save location and format, and does **not** load Brisk Emerald GBA `.sav`/`.srm` files. Previously created JavaScript campaign JSON in the Electron user-data directory is deliberately left untouched, but the old game UI and migration code have been removed.

## Next milestone

Verify a real Windows/Linux native startup and basic gameplay, then adapt Brisk Emerald's modified expansion code to the pinned native platform layer. This change does not claim the full Brisk campaign or save interoperability is implemented.
