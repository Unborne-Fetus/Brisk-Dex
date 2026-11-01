#!/usr/bin/env bash
# Local source build only; no binaries or proprietary game assets are distributed.
set -euo pipefail
target="${1:-}"
case "$target" in windows|linux);; *) echo 'Usage: bash tools/build-native-expansion.sh windows|linux' >&2; exit 2;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checkout="${BRISK_NATIVE_SOURCE_DIR:-$root/native-src/pokeemerald-expansion-native}"
remote="https://github.com/uehlbran/pokeemerald-expansion-native.git"
pin="bb3fd057061cdd7e6a9e79b76abb41924ee44ecc"
if [ ! -d "$checkout/.git" ]; then mkdir -p "$(dirname "$checkout")"; git clone "$remote" "$checkout"; fi
origin="$(git -C "$checkout" remote get-url origin)"
if [ "$origin" != "$remote" ] && [ "$origin" != "https://github.com/uehlbran/pokeemerald-expansion-native" ]; then echo "Unexpected native source remote: $origin" >&2; exit 1; fi
git -C "$checkout" fetch origin "$pin"
git -C "$checkout" checkout --detach "$pin"
python3 "$root/tools/patch-native-stream.py" "$checkout"
(cd "$checkout" && tools/build-native.sh --os "$target")
dest="$root/native-game"
if [ "$target" = windows ]; then
  mkdir -p "$dest/win32"
  cp "$checkout/build/native64-windows/pokeemerald-native.exe" "$dest/win32/pokeemerald-native.exe"
  cp "$checkout/build/native64-windows/SDL2.dll" "$dest/win32/SDL2.dll"
else
  mkdir -p "$dest/linux"
  cp "$checkout/build/native64/pokeemerald-native" "$dest/linux/pokeemerald-native"
fi
echo "Internal native engine staged under $dest; it will launch inside Brisk Dex."

