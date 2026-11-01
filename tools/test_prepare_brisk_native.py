#!/usr/bin/env python3
import unittest
from prepare_brisk_native import merge, resolve_conflicts


class SourceMergeTests(unittest.TestCase):
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
