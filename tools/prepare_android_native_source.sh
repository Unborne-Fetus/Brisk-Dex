#!/usr/bin/env bash
# Import the exact pinned Brisk source already used by the Windows game and
# connect the Android in-process frame/input hooks. No ROM or emulator.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
checkout="$root/native-src/brisk-emerald-native-android"
if [ "$#" -gt 0 ]; then checkout="$1"; fi
pins="$root/tools/brisk-native-source.json"
read_pin() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$pins" "$1"; }
native_pin="$(read_pin native_commit)"
brisk_pin="$(read_pin brisk_commit)"
expansion_pin="$(read_pin expansion_base)"
for hash in "$native_pin" "$brisk_pin" "$expansion_pin"; do
  if ! [[ "$hash" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Invalid pinned game source revision" >&2
    exit 2
  fi
done
if [ ! -d "$checkout/.git" ]; then
  mkdir -p "$(dirname "$checkout")"
  git clone --no-checkout --filter=blob:none \
    https://github.com/uehlbran/pokeemerald-expansion-native.git "$checkout"
fi
git -C "$checkout" config gc.auto 0
git -C "$checkout" fetch --depth 1 origin "$native_pin"
git -C "$checkout" checkout --detach "$native_pin"
git -C "$checkout" fetch --depth 1 \
  https://github.com/Unborne-Fetus/Pokemon-Brisk-Emerald.git "$brisk_pin"
git -C "$checkout" fetch --depth 1 \
  https://github.com/rh-hideout/pokeemerald-expansion.git "$expansion_pin"
git -C "$checkout" checkout "$native_pin" -- \
  platform/video.c platform/input.c platform/frame.c platform/main.c
python3 "$root/tools/prepare_brisk_native.py" "$checkout"
python3 "$root/tools/patch-native-compat.py" "$checkout"
python3 "$root/tools/patch-native-stream.py" "$checkout"
python3 "$root/tools/patch-native-android.py" "$checkout"
python3 "$root/tools/patch_android_assertions.py" "$checkout"
python3 "$root/tools/patch_android_types.py" "$checkout"
# The ARM64 host layer is part of the real native game checkout, so future
# whole-game archive builds can use the same source tree as the compiler audit.
install -m 0644 "$root/android-native/src/host_android.c" "$checkout/platform/host_android.c"
install -m 0644 "$root/android-native/src/host_android_stack.S" "$checkout/platform/host_android_stack.S"
install -m 0644 "$root/android-native/src/host_android_regions.c" "$checkout/platform/host_android_regions.c"
install -m 0644 "$root/android-native/src/gba_division_android.c" "$checkout/platform/gba_division_android.c"
install -m 0644 "$root/android-native/src/arm_division_android.c" "$checkout/platform/arm_division_android.c"
# Keep the upstream source intact: Android's full-source build is a separate
# Makefile and two compiler/assembler adapters in the prepared checkout.
install -m 0644 "$root/tools/Makefile.android" "$checkout/Makefile.android"
install -m 0644 "$root/tools/android_compile_source.py" "$checkout/tools/android_compile_source.py"
install -m 0644 "$root/tools/android_assemble.py" "$checkout/tools/android_assemble.py"
install -m 0644 "$root/tools/rewrite_android_division_ir.py" "$checkout/tools/rewrite_android_division_ir.py"
echo "Native Brisk source prepared with Android in-process hooks at $checkout"
echo "This does NOT yet produce a playable ARM libbriskgame.so."
