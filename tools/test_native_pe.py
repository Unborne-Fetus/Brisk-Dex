#!/usr/bin/env python3
"""Check the linker-version regression on fixtures and optionally a real engine."""
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

from native_pe_imports import headers, normalize, WRITE, READ, DISCARD, checksum


def fixture(import_before_data=False):
    names = [(b'.text', READ | 0x20000020), (b'.rdata', READ | 0x40),
             (b'.gamedat', READ | WRITE | 0x40), (b'.idata', READ | 0x40),
             (b'.bss', READ | WRITE | 0x80), (b'.debug', READ | DISCARD | 0x40)]
    if import_before_data:
        names[2], names[3] = names[3], names[2]
    data = bytearray(1025)
    data[:2] = b'MZ'
    struct.pack_into('<I', data, 0x3c, 0x80)
    data[0x80:0x84] = b'PE\0\0'
    struct.pack_into('<HH', data, 0x84, 0x8664, len(names))
    struct.pack_into('<H', data, 0x94, 240)
    optional = 0x98
    struct.pack_into('<H', data, optional, 0x20b)
    struct.pack_into('<Q', data, optional + 24, 0x40000000)
    for i, (name, flags) in enumerate(names):
        offset = optional + 240 + i * 40
        data[offset:offset + len(name)] = name
        struct.pack_into('<I', data, offset + 12, (i + 1) * 0x1000)
        struct.pack_into('<I', data, offset + 36, flags)
    return bytes(data)


class PEImportTests(unittest.TestCase):
    def test_import_permissions_change_without_moving_or_rewriting_sections(self):
        before = fixture()
        sections, check = headers(before)
        imports = next(section for section in sections if section[0] == b'.idata')
        after = normalize(before)
        self.assertNotEqual(after, before)
        self.assertEqual(len(after), len(before))
        expected = bytearray(before)
        struct.pack_into('<I', expected, imports[3], imports[2] | WRITE)
        struct.pack_into('<I', expected, check, checksum(expected, check))
        self.assertEqual(after, bytes(expected))
        self.assertEqual(normalize(after), after)
        self.assertEqual(struct.unpack_from('<I', after, check)[0], checksum(after, check))

    def test_readonly_imports_before_mutable_tail_are_unchanged(self):
        data = fixture(import_before_data=True)
        self.assertEqual(normalize(data), data)

    def test_unrelated_readonly_sections_stay_readonly(self):
        before = fixture()
        after = normalize(before)
        self.assertEqual([s for s in headers(before)[0] if s[0] != b'.idata'],
                         [s for s in headers(after)[0] if s[0] != b'.idata'])

    def test_malformed_images_are_rejected(self):
        for data in [b'', b'MZ' + bytes(62), fixture()[:400]]:
            with self.assertRaises(ValueError):
                normalize(data)


def real_engine(executable, checker):
    data = executable.read_bytes()
    sections, _ = headers(data)
    imports = next(s for s in sections if s[0] == b'.idata')
    broken = bytearray(data)
    struct.pack_into('<I', broken, imports[3], imports[2] & ~WRITE)
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / 'engine.exe'
        target.write_bytes(broken)
        result = subprocess.run([sys.executable, '-I', str(checker), '--gui', str(target)],
                                capture_output=True, text=True)
        if result.returncode == 0 or '.idata is read-only but follows' not in result.stderr:
            raise AssertionError('Did not reproduce the reported .idata layout failure: ' + result.stderr)
        target.write_bytes(normalize(target.read_bytes()))
        subprocess.run([sys.executable, '-I', str(checker), '--gui', str(target)], check=True)
    print('Reproduced and repaired the reported .idata error on the real native executable')


if __name__ == '__main__':
    if len(sys.argv) == 3:
        real_engine(Path(sys.argv[1]), Path(sys.argv[2]))
    else:
        unittest.main()
