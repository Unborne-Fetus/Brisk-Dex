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
(cd "$checkout" && tools/build-native.sh --os "$target")
if [ "$target" = windows ]; then
  echo "In Brisk Dex select: $checkout/build/native64-windows/pokeemerald-native.exe (keep SDL2.dll next to it)"
else
  echo "In Brisk Dex select: $checkout/build/native64/pokeemerald-native"
fi
