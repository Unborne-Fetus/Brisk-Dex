"""Native VBlank polling regression: Windows/Android must not busy-wait."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "patch_native_vblank.py"
spec = importlib.util.spec_from_file_location("patch_native_vblank", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class NativeVBlankPatch(unittest.TestCase):
    def test_makes_native_wireless_wait_use_host_frame_pump(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src"
            src.mkdir()
            text = "static void WaitForVBlank(void)\n{\n    gMain.intrCheck &= ~INTR_FLAG_VBLANK;\n\n" + module.BEFORE + "\n}\n"
            file = src / "main.c"
            file.write_text(text)
            self.assertTrue(module.patch(Path(tmp)))
            after = file.read_text()
            self.assertIn("#if PLATFORM_NATIVE\n    // Native hosts generate VBlank", after)
            self.assertIn("    VBlankIntrWait();\n#else\n" + module.BEFORE, after)
            self.assertEqual(after.count("while (!(gMain.intrCheck & INTR_FLAG_VBLANK))"), 1)
            self.assertFalse(module.patch(Path(tmp)))
            self.assertEqual(after, file.read_text())

    def test_unrecognized_game_revision_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src"
            src.mkdir()
            file = src / "main.c"
            file.write_text("void WaitForVBlank(void) { unknown(); }\n")
            before = file.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "source mismatch"):
                module.patch(Path(tmp))
            self.assertEqual(file.read_bytes(), before)

if __name__ == "__main__":
    unittest.main()
