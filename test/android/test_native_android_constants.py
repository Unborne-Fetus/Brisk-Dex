"""Regression tests for equal absolute assembly symbols in the ARM64 archive."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/android_assemble.py"


@unittest.skipUnless(all(shutil.which(name) for name in ("clang", "nm", "objcopy", "ld.lld")),
                     "requires Clang, binutils and lld")
class AbsoluteConstantTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def assemble(self, name, value):
        source = self.root / (name + ".s")
        obj = self.root / (name + ".o")
        source.write_text(f".globl MOVE_NONE\n.equiv MOVE_NONE, {value}\n"
                          f".text\n.globl {name}\n{name}:\n.word MOVE_NONE\n")
        subprocess.run(["clang", "--target=aarch64-linux-gnu", "-c",
                        str(source), "-o", str(obj)], check=True)
        return obj

    def normalize(self, *objects):
        return subprocess.run([sys.executable, str(SCRIPT),
                               "--normalize-absolute-constants",
                               "--nm", "nm", "--objcopy",
                               shutil.which("llvm-objcopy") or "objcopy",
                               *map(str, objects)], text=True, capture_output=True)

    def test_identical_constants_link_and_real_labels_survive(self):
        if not shutil.which("llvm-objcopy"):
            self.skipTest("requires LLVM objcopy for AArch64")
        a, b = self.assemble("battle_anim", 0), self.assemble("battle_script", 0)
        output = self.root / "game.so"
        link = ["ld.lld", "-shared", str(a), str(b), "-o", str(output)]
        before = subprocess.run(link, capture_output=True, text=True)
        self.assertNotEqual(before.returncode, 0)
        self.assertIn("duplicate symbol: MOVE_NONE", before.stderr)
        result = self.normalize(a, b)
        self.assertEqual(result.returncode, 0, result.stderr)
        subprocess.run(link, check=True)
        symbols = subprocess.check_output(["nm", "--format=posix", str(output)], text=True)
        self.assertIn("battle_anim T ", symbols)
        self.assertIn("battle_script T ", symbols)
        self.assertIn("MOVE_NONE A ", symbols)
        self.assertTrue(output.is_file())

    def test_conflicting_absolute_constants_fail_closed(self):
        a, b = self.assemble("battle_anim", 0), self.assemble("battle_script", 1)
        result = self.normalize(a, b)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Conflicting absolute constant MOVE_NONE", result.stderr)
        for obj in (a, b):
            self.assertIn("MOVE_NONE A ", subprocess.check_output(
                ["nm", "--format=posix", str(obj)], text=True))


if __name__ == "__main__":
    unittest.main()
