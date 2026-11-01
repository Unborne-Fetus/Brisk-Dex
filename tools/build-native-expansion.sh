#!/usr/bin/env bash
# Local source build only; no binaries or proprietary game assets are distributed.
set -euo pipefail
target="${1:-}"
case "$target" in windows|linux);; *) echo 'Usage: bash tools/build-native-expansion.sh windows|linux' >&2; exit 2;; esac
# BRISK_NATIVE_ROOT allows this script to be read from stdin after CRLF cleanup.
root="${BRISK_NATIVE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# WSL compilation belongs on the Linux filesystem, not /mnt/c (NTFS).
profile="${BRISK_NATIVE_PROFILE:-expansion}"
case "$profile" in expansion|brisk);; *) echo "Unknown native profile: $profile" >&2; exit 2;; esac
source_name=pokeemerald-expansion-native
if [ "$profile" = brisk ]; then source_name=brisk-emerald-native; fi
source_default="$root/native-src/$source_name"
if [ -n "${WSL_DISTRO_NAME:-}" ] || [[ "$root" == /mnt/* ]]; then
  cache_key="$(printf '%s' "$root" | sha256sum | cut -c1-12)"
  source_default="${XDG_CACHE_HOME:-$HOME/.cache}/brisk-dex/$cache_key/$source_name"
fi
checkout="${BRISK_NATIVE_SOURCE_DIR:-$source_default}"
deps_mode="${2:---check}"
# Normalize helper input too, for existing Windows CRLF checkouts.
sed 's/\r$//' "$root/tools/setup-native-deps.sh" | bash -s -- "$target" "$deps_mode"
remote="https://github.com/uehlbran/pokeemerald-expansion-native.git"
pin="bb3fd057061cdd7e6a9e79b76abb41924ee44ecc"
if [ ! -d "$checkout/.git" ]; then mkdir -p "$(dirname "$checkout")"; git clone --depth 1 "$remote" "$checkout"; fi
# Keep shallow source transactions serial; background auto-maintenance can
# change .git/shallow while another pinned source is being fetched.
git -C "$checkout" config gc.auto 0
git -C "$checkout" config maintenance.auto false
fetch_source() {
  local attempt
  for attempt in 1 2 3; do
    if git -C "$checkout" -c gc.auto=0 -c maintenance.auto=false fetch --depth 1 "$@"; then return 0; fi
    echo "Pinned source fetch attempt $attempt failed; retrying the transaction..." >&2
  done
  return 1
}
origin="$(git -C "$checkout" remote get-url origin)"
if [ "$origin" != "$remote" ] && [ "$origin" != "https://github.com/uehlbran/pokeemerald-expansion-native" ]; then echo "Unexpected native source remote: $origin" >&2; exit 1; fi
if ! git -C "$checkout" cat-file -e "$pin^{commit}" 2>/dev/null; then
  fetch_source origin "$pin"
fi
git -C "$checkout" checkout --detach "$pin"
if [ "$profile" = brisk ]; then
  # Pin both source trees; game assets are obtained from their original repo.
  brisk_pin="8d2b525214a61a89563facde52c79a567ade560b"
  base_pin="e8bd1cd7b03fc032ea37e3ecd38b379b5d01a1e7"
  if ! git -C "$checkout" cat-file -e "$brisk_pin^{commit}" 2>/dev/null; then
    fetch_source https://github.com/Unborne-Fetus/Pokemon-Brisk-Emerald.git "$brisk_pin"
  fi
  if ! git -C "$checkout" cat-file -e "$base_pin^{commit}" 2>/dev/null; then
    fetch_source https://github.com/rh-hideout/pokeemerald-expansion.git "$base_pin"
  fi
  python3 "$root/tools/prepare_brisk_native.py" "$checkout"
  git -C "$checkout" apply "$root/tools/brisk-native-port.patch"
fi
python3 "$root/tools/patch-native-compat.py" "$checkout"
python3 "$root/tools/patch-native-stream.py" "$checkout"
if [ "$target" = windows ]; then
  # Diagnose host compiler/API issues before the expensive asset conversion.
  (cd "$checkout" && make -f Makefile.native sdl2-mingw BITS=64 TARGET_OS=windows \
    && make -C platform -j"$(nproc)" lib BITS=64 TARGET_OS=windows NOSAN=1)
fi
(cd "$checkout" && BRISK_NATIVE_TARGET="$target" bash tools/build-native.sh --os "$target")
dest="$root/native-game"
if [ "$target" = windows ]; then
  platform_dir=win32
  mkdir -p "$dest/win32"
  cp "$checkout/build/native64-windows/pokeemerald-native.exe" "$dest/win32/pokeemerald-native.exe"
  cp "$checkout/build/native64-windows/SDL2.dll" "$dest/win32/SDL2.dll"
  cp "$checkout/build/native64-windows/pokeemerald-native.exe.symbols" "$dest/win32/pokeemerald-native.exe.symbols"
else
  platform_dir=linux
  mkdir -p "$dest/linux"
  cp "$checkout/build/native64/pokeemerald-native" "$dest/linux/pokeemerald-native"
  cp "$checkout/build/native64/pokeemerald-native.symbols" "$dest/linux/pokeemerald-native.symbols"
fi
python3 "$root/tools/native_build_info.py" "$dest/$platform_dir" "$checkout" "$profile" "$pin"
echo "Internal native engine staged under $dest; it will launch inside Brisk Dex."

