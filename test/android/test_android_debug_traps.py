"""Fail-closed Android replacement for the original GBA debug trap opcode."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[2]/"tools"/"patch_android_assertions.py"
spec=importlib.util.spec_from_file_location("android_traps",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AndroidDebugTraps(unittest.TestCase):
    def test_only_android_branch_changes_and_remains_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            src=root/"src"
            src.mkdir()
            file=src/"libisagbprn.c"
            file.write_text('\n'.join(['asm("test");','        asm(".hword 0xEFFF");']*3)+'\n')
            self.assertTrue(module.patch(root))
            result=file.read_text()
            self.assertEqual(result.count('__builtin_trap();'),3)
            self.assertEqual(result.count('asm(".hword 0xEFFF");'),3)
            self.assertEqual(result.count('#ifdef BRISK_ANDROID'),3)
            self.assertFalse(module.patch(root))
            self.assertEqual(result,file.read_text())
    def test_does_not_modify_unknown_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/"src"
            src.mkdir()
            file=src/"libisagbprn.c"
            file.write_text('        asm(".hword 0xEFFF");\n')
            with self.assertRaisesRegex(RuntimeError,"pinned source mismatch"):
                module.patch(Path(tmp))
            self.assertEqual(file.read_text(),'        asm(".hword 0xEFFF");\n')
