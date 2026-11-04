#!/usr/bin/env python3
"""Decode 40-byte serialized trainerbattle scripts on 64-bit native hosts.

The original event macro emits 32-bit script addresses, but the GBA C
TrainerBattleParameter has eight pointer fields. The native 64-bit struct
contains 8-byte pointers: memcpy(sizeof(struct)) overreads the bytecode and
misinterprets trainer text/continuations. Convert only the on-disk script
wire representation; do not change the struct used by battle logic.
"""
from pathlib import Path
import argparse

ANCHOR = "void TrainerBattleLoadArgs(const u8 *data)\n{"
OLD_LOAD = """void TrainerBattleLoadArgs(const u8 *data)
{
    InitTrainerBattleParameter();
    memcpy(gTrainerBattleParameter.data, data, sizeof(TrainerBattleParameter));
    sTrainerBattleEndScript = (u8*)data + sizeof(TrainerBattleParameter);
}"""
NEW_LOAD = """void TrainerBattleLoadArgs(const u8 *data)
{
    InitTrainerBattleParameter();
#if PLATFORM_NATIVE && UINTPTR_MAX > UINT32_MAX
    gTrainerBattleParameter = NativeDecodeTrainerBattleParameter(data);
    sTrainerBattleEndScript = (u8*)data + NATIVE_TRAINER_WIRE_SIZE;
#else
    memcpy(gTrainerBattleParameter.data, data, sizeof(TrainerBattleParameter));
    sTrainerBattleEndScript = (u8*)data + sizeof(TrainerBattleParameter);
#endif
}"""
HELPER = """#if PLATFORM_NATIVE && UINTPTR_MAX > UINT32_MAX
// Unaligned, little-endian GBA bytecode offsets (not native struct offsets).
#define NATIVE_TRAINER_WIRE_SIZE 40u
static u16 NativeTrainerReadU16(const u8 *src)
{
    return (u16)src[0] | ((u16)src[1] << 8);
}
static u32 NativeTrainerReadU32(const u8 *src)
{
    return (u32)src[0] | ((u32)src[1] << 8) | ((u32)src[2] << 16) | ((u32)src[3] << 24);
}
static u8 *NativeTrainerReadPointer(const u8 *src)
{
    return (u8 *)(uintptr_t)NativeTrainerReadU32(src);
}
static TrainerBattleParameter NativeDecodeTrainerBattleParameter(const u8 *src)
{
    TrainerBattleParameter result = {0};
    const u8 flags = src[0];
    result.params.isDoubleBattle = !!(flags & (1u << 0));
    result.params.isRematch = !!(flags & (1u << 1));
    result.params.playMusicA = !!(flags & (1u << 2));
    result.params.playMusicB = !!(flags & (1u << 3));
    result.params.continueScript = !!(flags & (1u << 4));
    result.params.facePlayer = !!(flags & (1u << 5));
    result.params.earlyRival = !!(flags & (1u << 6));
    result.params.skipFlagCheck = !!(flags & (1u << 7));
    result.params.objEventLocalIdA = src[1];
    result.params.opponentA = NativeTrainerReadU16(src + 2);
    result.params.introTextA = NativeTrainerReadPointer(src + 4);
    result.params.defeatTextA = NativeTrainerReadPointer(src + 8);
    result.params.battleScriptRetAddrA = NativeTrainerReadPointer(src + 12);
    result.params.objEventLocalIdB = src[16];
    result.params.opponentB = NativeTrainerReadU16(src + 17);
    result.params.introTextB = NativeTrainerReadPointer(src + 19);
    result.params.defeatTextB = NativeTrainerReadPointer(src + 23);
    result.params.battleScriptRetAddrB = NativeTrainerReadPointer(src + 27);
    result.params.victoryText = NativeTrainerReadPointer(src + 31);
    result.params.cannotBattleText = NativeTrainerReadPointer(src + 35);
    result.params.rivalBattleFlags = src[39];
    return result;
}
#endif

"""
TEMP_DECL = """#if PLATFORM_NATIVE && UINTPTR_MAX > UINT32_MAX
    TrainerBattleParameter nativeParams = NativeDecodeTrainerBattleParameter(data);
    TrainerBattleParameter *temp = &nativeParams;
#else
    TrainerBattleParameter *temp = (TrainerBattleParameter*)data;
#endif"""
OLD_DECL = "    TrainerBattleParameter *temp = (TrainerBattleParameter*)data;"

def patch(repo: Path) -> bool:
    file = Path(repo) / "src" / "battle_setup.c"
    original = file.read_text(encoding="utf-8")
    if HELPER in original and NEW_LOAD in original and original.count(TEMP_DECL) == 3:
        return False
    if (HELPER in original or NEW_LOAD in original or TEMP_DECL in original or
        original.count(OLD_LOAD) != 1 or original.count(OLD_DECL) != 3):
        raise RuntimeError("Native trainer battle layout: source mismatch, refuse partial patch")
    text = original.replace(OLD_LOAD, HELPER + NEW_LOAD)
    text = text.replace(OLD_DECL, TEMP_DECL)
    # UINTPTR_MAX and UINT32_MAX live in stdint.h; do not assume transitive headers.
    if '#include <stdint.h>' not in text:
        lines = text.splitlines(keepends=True)
        index = next((n for n,line in enumerate(lines) if line.startswith('#include ')), None)
        if index is None:
            raise RuntimeError("Native trainer battle: include anchor unavailable")
        lines.insert(index, "#include <stdint.h>\n")
        text = "".join(lines)
    file.write_text(text, encoding="utf-8")
    return True

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", type=Path)
    args = ap.parse_args()
    print("Decoded 40-byte native trainer script layout" if patch(args.source)
          else "Native trainer script decoding already patched")
