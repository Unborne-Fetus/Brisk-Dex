# Internal native-game staging area

Run `bash tools/build-native-expansion.sh windows` in WSL or `... linux` on Linux to compile a private local copy of the native pokeemerald-expansion code, patching its platform transport. The compiled engine is copied into `win32/` or `linux/` here; those binary directories are intentionally ignored by git.

Brisk Dex uses that **internal** engine to display 240×160 BGR555 frames in its own game tab. Users never select an executable. **Only distribute a built game if you have the rights to distribute its game data/assets.** The default public build is a companion-only app until a legally distributable native engine is supplied.
