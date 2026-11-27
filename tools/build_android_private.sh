#!/usr/bin/env bash
# Build a personal-use integrated APK from the pinned source, without publishing.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
if [ "$#" -ne 2 ]; then
  echo "Usage: bash tools/build_android_private.sh VERSION_SEQUENCE OUTPUT_DIRECTORY" >&2
  exit 2
fi
sequence="$1"
out="$2"
if ! [[ "$sequence" =~ ^[1-9][0-9]*$ ]]; then
  echo "A positive version sequence is required." >&2
  exit 2
fi
for tool in git node npm java javac python3 make clang aarch64-linux-gnu-as; do
  command -v "$tool" >/dev/null || { echo "Missing build prerequisite: $tool" >&2; exit 2; }
done
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
export ANDROID_HOME="$sdk" ANDROID_SDK_ROOT="$sdk"
test -x "$sdk/ndk/27.2.12479018/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang" ||
  { echo "Install Linux Android NDK 27.2.12479018 in $sdk" >&2; exit 2; }
test -x "$sdk/cmake/3.22.1/bin/cmake" ||
  { echo "Install Android SDK CMake 3.22.1 in $sdk" >&2; exit 2; }
# Linux build tools and Gradle cannot use the Windows SDK in /mnt/c.
case "$root" in /mnt/*) echo "Use a separate WSL/Linux checkout, not a Windows filesystem checkout." >&2; exit 2;; esac
mkdir -p "$out"
out="$(cd "$out" && pwd)"
apk="$out/Brisk-Dex-Integrated-${sequence}.apk"
if [ -e "$apk" ]; then
  echo "Refusing to overwrite existing APK: $apk" >&2
  exit 2
fi
export BRISK_ANDROID_SDL2_SOURCE="${BRISK_ANDROID_SDL2_SOURCE:-$root/native-src/SDL2-2.30.12}"
if [ ! -d "$BRISK_ANDROID_SDL2_SOURCE/.git" ]; then
  mkdir -p "$(dirname "$BRISK_ANDROID_SDL2_SOURCE")"
  git clone --depth 1 --branch release-2.30.12 https://github.com/libsdl-org/SDL.git "$BRISK_ANDROID_SDL2_SOURCE"
fi
test "$(git -C "$BRISK_ANDROID_SDL2_SOURCE" describe --tags --exact-match HEAD)" = release-2.30.12
export BRISK_ANDROID_NATIVE_SOURCE_DIR="$root/native-src/brisk-emerald-native-android"
export BRISK_ANDROID_JOBS="${BRISK_ANDROID_JOBS:-2}"
bash tools/build_android_game_archive.sh
export BRISK_ANDROID_GAME_ARCHIVE="$BRISK_ANDROID_NATIVE_SOURCE_DIR/build/android-arm64/libbrisk-game-arm64.a"
node tools/set_android_version.mjs "$sequence"
bash tools/package_android_full_game.sh
built="$root/android/app/build/outputs/apk/debug/app-debug.apk"
pin="$(python3 -c 'import json; print(json.load(open("tools/brisk-native-source.json"))["brisk_commit"])')"
python3 tools/inspect_android_apk.py "$built" --expected-commit "$pin" --require-game --output "$out/Brisk-Dex-Integrated-${sequence}.json"
cp --no-clobber "$built" "$apk"
sha256sum "$apk"
echo "Verified integrated APK: $apk"
echo "Personal local build only. The persistent local debug signer may differ from existing installations. Back up saves before any reinstall."
