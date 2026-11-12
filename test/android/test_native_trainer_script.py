"""Check that native trainer script data decodes without 64-bit struct overread."""
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOL=Path(__file__).resolve().parents[2]/"tools"/"patch_native_trainer_script.py"
spec=importlib.util.spec_from_file_location("patch_native_trainer_script",TOOL)
patcher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)

class NativeTrainerScript(unittest.TestCase):
    def test_patch_fail_closed_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            src=root/"src"
            src.mkdir()
            file=src/"battle_setup.c"
            before="#include <stdio.h>\n"+patcher.OLD_LOAD+"\n"
            before+=(patcher.OLD_DECL+"\n")*3
            file.write_text(before)
            self.assertTrue(patcher.patch(root))
            result=file.read_text()
            self.assertIn(patcher.HELPER,result)
            self.assertIn(patcher.NEW_LOAD,result)
            self.assertEqual(result.count(patcher.TEMP_DECL),3)
            self.assertFalse(patcher.patch(root))
            self.assertEqual(result,file.read_text())
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            src=root/"src"
            src.mkdir()
            file=src/"battle_setup.c"
            file.write_text("#include <stdio.h>\nvoid unexpected(void) {}\n")
            with self.assertRaisesRegex(RuntimeError,"source mismatch"):
                patcher.patch(root)

    @unittest.skipUnless(shutil.which("cc"), "C compiler not available")
    def test_compiled_wire_decode_offsets_and_native_pointer_width(self):
        # Fake just the original 64-bit C struct; compile the exact helper
        # added to the game and check the 40-byte GBA wire layout.
        c_source = r"""
#include <stdint.h>
#include <stddef.h>
#include <assert.h>
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef union __attribute__((packed)) {
 struct __attribute__((packed)) {
  u8 isDoubleBattle:1, isRematch:1, playMusicA:1, playMusicB:1,
     continueScript:1, facePlayer:1, earlyRival:1, skipFlagCheck:1;
  u8 objEventLocalIdA;
  u16 opponentA;
  u8 *introTextA, *defeatTextA, *battleScriptRetAddrA;
  u8 objEventLocalIdB;
  u16 opponentB;
  u8 *introTextB, *defeatTextB, *battleScriptRetAddrB;
  u8 *victoryText, *cannotBattleText;
  u8 rivalBattleFlags;
 } params;
} TrainerBattleParameter;
#define PLATFORM_NATIVE 1
""" + patcher.HELPER + r"""
static void assert_native_pointer_near_wire(const void *wire, const void *pointer, uint32_t low) {
  uintptr_t actual=(uintptr_t)pointer, origin=(uintptr_t)wire;
  assert((uint32_t)actual==low);
  assert(actual>UINT32_MAX);
  assert(actual>=origin ? actual-origin<0x80000000ull : origin-actual<0x80000000ull);
}
int main(void) {
  const u8 wire[40] = {
     0xb5, 7, 0x14, 0x02,      /* flags; local A; trainer 532 */
     0x10,0x20,0x30,0x40,      /* intro A */
     0x11,0x21,0x31,0x41,      /* defeat A */
     0x12,0x22,0x32,0x42,      /* return A */
     9, 0x01, 0x02,            /* local B; trainer 513 */
     0x13,0x23,0x33,0x43,      /* intro B */
     0x14,0x24,0x34,0x44,      /* defeat B */
     0x15,0x25,0x35,0x45,      /* return B */
     0x16,0x26,0x36,0x46,      /* victory */
     0x17,0x27,0x37,0x47,      /* not enough party */
     0xe1                     /* rival battle flags */
  };
  assert(sizeof(TrainerBattleParameter)>40);
  const TrainerBattleParameter t = NativeDecodeTrainerBattleParameter(wire);
  assert(t.params.opponentA==532 && t.params.opponentB==513);
  assert(t.params.objEventLocalIdA==7 && t.params.objEventLocalIdB==9);
  assert(t.params.isDoubleBattle==1 && t.params.isRematch==0);
  assert(t.params.playMusicA==1 && t.params.playMusicB==0);
  assert(t.params.continueScript==1 && t.params.facePlayer==1);
  assert(t.params.earlyRival==0 && t.params.skipFlagCheck==1);
  assert_native_pointer_near_wire(wire, t.params.introTextA, 0x40302010u);
  assert_native_pointer_near_wire(wire, t.params.defeatTextA, 0x41312111u);
  assert_native_pointer_near_wire(wire, t.params.battleScriptRetAddrA, 0x42322212u);
  assert_native_pointer_near_wire(wire, t.params.introTextB, 0x43332313u);
  assert_native_pointer_near_wire(wire, t.params.defeatTextB, 0x44342414u);
  assert_native_pointer_near_wire(wire, t.params.battleScriptRetAddrB, 0x45352515u);
  assert_native_pointer_near_wire(wire, t.params.victoryText, 0x46362616u);
  assert_native_pointer_near_wire(wire, t.params.cannotBattleText, 0x47372717u);
  assert(t.params.rivalBattleFlags==0xe1);
  return 0;
}
"""
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            src=root/"test.c"
            binary=root/"test.exe"
            src.write_text(c_source)
            compiled=subprocess.run(["cc","-std=gnu17","-Wall","-Wextra","-Werror",str(src),"-o",str(binary)],capture_output=True,text=True)
            self.assertEqual(compiled.returncode,0,compiled.stdout+compiled.stderr)
            subprocess.run([str(binary)],capture_output=True,text=True,check=True,timeout=10)

if __name__=="__main__":
    unittest.main()
