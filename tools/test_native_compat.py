#!/usr/bin/env python3
"""Regression checks for repeated builds of the pinned native checkout."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("native_compat", Path(__file__).with_name("patch-native-compat.py"))
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)


class CompatibilityPatchTests(unittest.TestCase):
    def test_patch_is_idempotent_and_leaves_gameplay_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            platform = root / "platform"
            platform.mkdir()
            source = '#include <stdio.h>\nvoid logger(const char *, ...) __attribute__((format(printf, 1, 2)));\nvoid diagnostic(void) { fprintf(stderr, "%zu", (size_t)1); }\n'
            (platform / "bios_internal.c").write_text(source)
            untouched = 'int value(void) { return 1; }\n'
            (platform / "pure.c").write_text(untouched)
            (root / "src").mkdir()
            (root / "src/game.c").write_text(source)
            compat.apply(root)
            first = {p.name: p.read_bytes() for p in platform.iterdir()}
            compat.apply(root)
            self.assertEqual(first, {p.name: p.read_bytes() for p in platform.iterdir()})
            self.assertIn('#include "brisk_stdio.h"', (platform / "bios_internal.c").read_text())
            self.assertIn('format(gnu_printf,', (platform / "bios_internal.c").read_text())
            self.assertEqual((platform / "pure.c").read_text(), untouched)
            self.assertEqual((root / "src/game.c").read_text(), source)

    def test_unexpected_source_checkout_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "platform sources not found"):
                compat.apply(Path(tmp))


if __name__ == "__main__":
    unittest.main()
