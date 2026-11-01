#!/usr/bin/env python3
import unittest
from pathlib import Path
import subprocess
import tempfile
from prepare_brisk_native import apply_port_patch, merge, resolve_conflicts


class SourceMergeTests(unittest.TestCase):
    def test_windows_and_linux_patch_checkouts_apply_to_lf_imports(self):
        for crlf in (False, True):
            with self.subTest(crlf=crlf), tempfile.TemporaryDirectory(prefix='brisk patch ') as tmp:
                repo = Path(tmp)
                subprocess.run(['git', 'init', '-q', str(repo)], check=True)
                subprocess.run(['git', '-C', str(repo), 'config', 'core.autocrlf', 'false'], check=True)
                source = repo / 'game.c'
                before = b'int native_heap = 1;\nint game_feature = 1;\n'
                after = b'int native_heap = 16;\nint game_feature = 1;\n'
                source.write_bytes(before)
                subprocess.run(['git', '-C', str(repo), 'add', 'game.c'], check=True)
                source.write_bytes(after)
                patch_bytes = subprocess.check_output(['git', '-C', str(repo), 'diff', '--', 'game.c'])
                source.write_bytes(before)
                patch = repo / 'port.patch'
                patch.write_bytes(patch_bytes.replace(b'\n', b'\r\n') if crlf else patch_bytes)
                if crlf:
                    rejected = subprocess.run(['git', '-C', str(repo), 'apply', '--check', str(patch)], capture_output=True)
                    self.assertNotEqual(rejected.returncode, 0, 'Reproduce the reported CRLF failure')
                apply_port_patch(repo, patch)
                self.assertEqual(source.read_bytes(), after)

    def test_incompatible_patch_still_stops_the_build_without_changing_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            source = repo / 'game.c'
            source.write_bytes(b'actual source\n')
            patch = repo / 'port.patch'
            patch.write_bytes(b'diff --git a/game.c b/game.c\n--- a/game.c\n+++ b/game.c\n@@ -1 +1 @@\n-unexpected source\n+replacement\n')
            with self.assertRaises(subprocess.CalledProcessError):
                apply_port_patch(repo, patch)
            self.assertEqual(source.read_bytes(), b'actual source\n')

    def test_independent_game_feature_and_native_guard_survive(self):
        base = b'one\ntwo\nthree\nfour\nfive\n'
        host = b'native guard\none\ntwo\nthree\nfour\nfive\n'
        brisk = b'one\ntwo\nthree\nfour\nfive\nBrisk feature\n'
        result, conflict = merge('src/example.c', host, base, brisk)
        self.assertFalse(conflict)
        self.assertIn(b'native guard', result)
        self.assertIn(b'Brisk feature', result)

    def test_conflict_resolution_preserves_all_surrounding_content(self):
        data = (b'function before\n<<<<<<< native\nold\n=======\nBrisk save\n>>>>>>> brisk\n'
                b'function after\n<<<<<<< native\nold2\n=======\nnew2\n>>>>>>> brisk\nlast function\n')
        result = resolve_conflicts('src/save.c', data)
        self.assertEqual(result, b'function before\nBrisk save\nfunction after\nnew2\nlast function\n')

    def test_new_unreviewed_conflicts_stop_the_build(self):
        with self.assertRaisesRegex(RuntimeError, 'Unreviewed'):
            resolve_conflicts('src/unreviewed.c', b'<<<<<<< native\na\n=======\nb\n>>>>>>> brisk\n')


if __name__ == '__main__':
    unittest.main()
