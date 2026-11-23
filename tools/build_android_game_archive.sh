#!/usr/bin/env bash
# Build the REAL pinned Brisk Emerald C source for Android ARM64.
# Produces a full native .a; never creates a dummy libbriskgame.so.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${sdk:?Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK}"
: "${BRISK_ANDROID_SDL2_SOURCE:?Set BRISK_ANDROID_SDL2_SOURCE to SDL2 2.30.12 sources}"
if [ ! -f "${BRISK_ANDROID_SDL2_SOURCE}/include/SDL.h" ] ||
   [ ! -f "${BRISK_ANDROID_SDL2_SOURCE}/CMakeLists.txt" ]; then
  echo "SDL2 source must contain include/SDL.h and CMakeLists.txt" >&2
  exit 2
fi
ndk="$sdk/ndk/27.2.12479018"
toolchain="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
cc="$toolchain/aarch64-linux-android26-clang"
ar="$toolchain/llvm-ar"
nm="$toolchain/llvm-nm"
for tool in "$cc" "$ar" "$nm"; do
  if [ ! -x "$tool" ]; then
    echo "Android ARM64 NDK 27.2.12479018 tool missing: $tool" >&2
    exit 2
  fi
done
if ! command -v aarch64-linux-gnu-as >/dev/null; then
  echo "GNU AArch64 assembler missing: install binutils-aarch64-linux-gnu" >&2
  exit 2
fi
checkout="${BRISK_ANDROID_NATIVE_SOURCE_DIR:-$root/native-src/brisk-emerald-native-android}"
bash "$root/tools/prepare_android_native_source.sh" "$checkout"
jobs="${BRISK_ANDROID_JOBS:-2}"
if ! [[ "$jobs" =~ ^[1-9][0-9]*$ ]]; then
  echo "BRISK_ANDROID_JOBS must be a positive integer" >&2
  exit 2
fi
# Build ALL original C and data/song objects; no placeholder archive.
make -C "$checkout" -f Makefile.android -j"$jobs" android-game-archive \
  ANDROID_CC="$cc" ANDROID_AR="$ar" \
  SDL_INCLUDE="$(cd "$BRISK_ANDROID_SDL2_SOURCE/include" && pwd)" \
  OBJ_DIR=build/android-arm64
archive="$checkout/build/android-arm64/libbrisk-game-arm64.a"
if [ ! -s "$archive" ]; then
  echo "Android native build returned without a complete archive" >&2
  exit 1
fi
"$ar" t "$archive" >/dev/null
"$nm" --defined-only "$archive" > "$checkout/build/android-arm64/native-symbols.txt"
if ! grep -Eq ' [TW] brisk_android_game_main$' "$checkout/build/android-arm64/native-symbols.txt" ||
   ! grep -Eq ' [TW] AgbMain$' "$checkout/build/android-arm64/native-symbols.txt"; then
  echo "Archive is incomplete: required entry points are missing." >&2
  echo "Actual ARM64 entry-point symbols:" >&2
  grep -E ' (main|SDL_main|brisk_android_game_main|AgbMain|AgbMainLoop)$' \
    "$checkout/build/android-arm64/native-symbols.txt" >&2 || true
  exit 1
fi
echo "Full Brisk ARM64 archive ready: $archive"
echo "Set BRISK_ANDROID_GAME_ARCHIVE to that path before APK packaging."
