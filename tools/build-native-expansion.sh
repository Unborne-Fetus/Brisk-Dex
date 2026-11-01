#!/usr/bin/env bash
# Local source build only; no binaries or proprietary game assets are distributed.
set -euo pipefail
target="${1:-}"
case "$target" in windows|linux);; *) echo 'Usage: bash tools/build-native-expansion.sh windows|linux' >&2; exit 2;; esac
# BRISK_NATIVE_ROOT allows this script to be read from stdin after CRLF cleanup.
root="${BRISK_NATIVE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# WSL compilation belongs on the Linux filesystem, not /mnt/c (NTFS).
source_default="$root/native-src/pokeemerald-expansion-native"
if [ -n "${WSL_DISTRO_NAME:-}" ] || [[ "$root" == /mnt/* ]]; then
  cache_key="$(printf '%s' "$root" | sha256sum | cut -c1-12)"
  source_default="${XDG_CACHE_HOME:-$HOME/.cache}/brisk-dex/$cache_key/pokeemerald-expansion-native"
fi
checkout="${BRISK_NATIVE_SOURCE_DIR:-$source_default}"
deps_mode="${2:---check}"
# Normalize helper input too, for existing Windows CRLF checkouts.
sed 's/\r$//' "$root/tools/setup-native-deps.sh" | bash -s -- "$target" "$deps_mode"
remote="https://github.com/uehlbran/pokeemerald-expansion-native.git"
pin="bb3fd057061cdd7e6a9e79b76abb41924ee44ecc"
if [ ! -d "$checkout/.git" ]; then mkdir -p "$(dirname "$checkout")"; git clone --depth 1 "$remote" "$checkout"; fi
origin="$(git -C "$checkout" remote get-url origin)"
if [ "$origin" != "$remote" ] && [ "$origin" != "https://github.com/uehlbran/pokeemerald-expansion-native" ]; then echo "Unexpected native source remote: $origin" >&2; exit 1; fi
if ! git -C "$checkout" cat-file -e "$pin^{commit}" 2>/dev/null; then
  git -C "$checkout" fetch --depth 1 origin "$pin"
fi
git -C "$checkout" checkout --detach "$pin"
python3 "$root/tools/patch-native-compat.py" "$checkout"
python3 "$root/tools/patch-native-stream.py" "$checkout"
(cd "$checkout" && bash tools/build-native.sh --os "$target")
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

