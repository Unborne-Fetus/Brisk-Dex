#!/usr/bin/env bash
# Package the exact pinned C game (NOT an emulator) into one Android APK.
# Fails closed unless a complete Android ARM64 game archive is available.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

: "${BRISK_ANDROID_GAME_ARCHIVE:?Set BRISK_ANDROID_GAME_ARCHIVE to the complete ARM64 Brisk .a produced by the NDK game port}"
if [[ ! -f "$BRISK_ANDROID_GAME_ARCHIVE" ]]; then
  echo "Missing Android ARM64 native game archive: $BRISK_ANDROID_GAME_ARCHIVE" >&2
  exit 2
fi
if [[ -n "${BRISK_ANDROID_SDL2_SOURCE:-}" && -n "${BRISK_ANDROID_SDL2_LIBRARY:-}" ]] ||
   [[ -z "${BRISK_ANDROID_SDL2_SOURCE:-}" && -z "${BRISK_ANDROID_SDL2_LIBRARY:-}" ]]; then
  echo "Provide exactly one SDL2 Android dependency: BRISK_ANDROID_SDL2_SOURCE or BRISK_ANDROID_SDL2_LIBRARY" >&2
  exit 2
fi
if [[ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]]; then
  echo "Android SDK/NDK is required; set ANDROID_HOME or ANDROID_SDK_ROOT." >&2
  exit 2
fi
# Verify the input is an ARM64 static archive with the *real* game entry
# point. The final strict CMake link checks the rest of the dependencies.
sdk="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
ndk="$sdk/ndk/27.2.12479018"
toolchain="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
if [[ ! -x "$toolchain/llvm-ar" || ! -x "$toolchain/llvm-nm" ]]; then
  echo "Install Android NDK 27.2.12479018 before building the integrated APK." >&2
  exit 2
fi
if ! "$toolchain/llvm-ar" t "$BRISK_ANDROID_GAME_ARCHIVE" >/dev/null; then
  echo "Invalid native game archive: not a readable LLVM/Unix archive." >&2
  exit 2
fi
nm_report="$(mktemp)"
trap 'rm -f "$nm_report"' EXIT
"$toolchain/llvm-nm" --defined-only "$BRISK_ANDROID_GAME_ARCHIVE" >"$nm_report"
if ! grep -Eq ' [TW] brisk_android_game_main$' "$nm_report"; then
  echo "Archive does not define the real Brisk native game entry point." >&2
  exit 2
fi
if ! grep -Eq ' [TW] AgbMain$' "$nm_report"; then
  echo "Archive does not contain the Pokémon gameplay entry point (AgbMain)." >&2
  exit 2
fi

npm ci
npm run android:prepare
if [[ ! -f android/app/build.gradle ]]; then
  npx cap add android
fi
node tools/patch_android.mjs
npx cap sync android
chmod +x android/gradlew
(cd android && ./gradlew --no-daemon assembleDebug)

apk="android/app/build/outputs/apk/debug/app-debug.apk"
pin="$(python3 -c 'import json;print(json.load(open("tools/brisk-native-source.json"))["brisk_commit"])')"
python3 tools/inspect_android_apk.py "$apk" --expected-commit "$pin" \
  --require-game --output android-game-status.json

# Preserve the generated core in the APK, not as an external game launcher.
python3 - "$apk" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as apk:
    required=("lib/arm64-v8a/libbriskandroid.so", "lib/arm64-v8a/libbriskgame.so")
    for entry in required:
        if entry not in apk.namelist():
            raise SystemExit("Native game was not packaged: "+entry)
print("Both the JNI transport and the real shared game are inside the APK.")
PY
echo "Built integrated Android game APK: $apk"
