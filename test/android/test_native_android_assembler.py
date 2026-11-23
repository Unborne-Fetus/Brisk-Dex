"""Verify Android game .set constants stay local, not duplicate exported symbols."""
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BINUTILS = all(shutil.which(name) for name in ("as", "nm", "objcopy", "ld"))

@unittest.skipUnless(BINUTILS, "GNU assembler tools unavailable")
class AndroidAssemblerSymbolTests(unittest.TestCase):
    def test_constant_aliases_localized_without_removing_real_game_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            objects = []
            for label in ("gGameDataOne", "gGameDataTwo"):
                output = root / (label + ".o")
                source = (
                    ".globl MALE\n.set MALE, 0\n"
                    ".globl DIR_NONE\n.set DIR_NONE, 0\n"
                    ".globl FRONTIER_LVL_50\n.set FRONTIER_LVL_50, 50\n"
                    ".globl " + label + "\n" + label + ":\n.byte 0\n"
                )
                result = subprocess.run(
                    [sys.executable, str(ROOT / "tools/android_assemble.py"),
                     "--compiler", "unused", "--assembler", "as",
                     "--nm", "nm", "--objcopy", "objcopy", "-o", str(output)],
                    input=source.encode(), capture_output=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
                exported = subprocess.run(
                    ["nm", "-g", "--defined-only", "-P", str(output)],
                    capture_output=True, text=True, check=True,
                ).stdout
                self.assertIn(label, exported)
                for constant in ("MALE", "DIR_NONE", "FRONTIER_LVL_50"):
                    self.assertNotRegex(exported, rf"(?m)^{re.escape(constant)}\s+A\s")
                objects.append(str(output))
            merged = root / "combined.o"
            combined = subprocess.run(
                ["ld", "-r", "-o", str(merged), *objects],
                capture_output=True, text=True,
            )
            self.assertEqual(combined.returncode, 0, combined.stderr)

if __name__ == "__main__":
    unittest.main()
