"""Fail-closed correction of const-qualified scalar callback return types."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[2]/"tools"/"patch_android_types.py"
spec=importlib.util.spec_from_file_location("android_types",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AndroidCallbackTypePatches(unittest.TestCase):
    def test_replaces_only_two_tables_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            src=Path(temp)/'src'
            src.mkdir()
            file=src/'ow_abilities.c'
            file.write_text(
                'static const bool32 (*const first[])(enum Species) = {};\n'
                'static const bool32 (*const second[])(enum Species) = {};\n'
                'static const int another_value = 2;\n'
            )
            self.assertTrue(module.patch(Path(temp)))
            altered=file.read_text()
            self.assertEqual(altered.count('static bool32 (*const '),2)
            self.assertIn('static const int another_value',altered)
            self.assertFalse(module.patch(Path(temp)))
            self.assertEqual(altered,file.read_text())
    def test_unknown_source_fails_without_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            src=Path(temp)/'src'
            src.mkdir()
            file=src/'ow_abilities.c'
            file.write_text('static const bool32 (*const first[])();\n')
            before=file.read_text()
            with self.assertRaisesRegex(RuntimeError,'pinned source mismatch'):
                module.patch(Path(temp))
            self.assertEqual(file.read_text(),before)
