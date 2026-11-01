#!/usr/bin/env python3
"""Normalize a MinGW import section inside the native image's writable tail.

Some binutils versions make .idata read-only although the pinned linker script
places it after the game's writable data. The platform requires one contiguous
writable tail. Restore the conventional writable import section without moving
sections, changing import addresses, or disabling the upstream layout validator.
"""
import argparse
from array import array
from pathlib import Path
import struct
import sys

CODE_ADDRESS = 0x40001000
WRITE = 0x80000000
READ = 0x40000000
DISCARD = 0x02000000
EXECUTE = 0x20000000


def headers(data):
    if len(data) < 64 or data[:2] != b'MZ':
        raise ValueError('Expected a native Windows PE executable')
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    if pe + 24 > len(data) or data[pe:pe + 4] != b'PE\0\0':
        raise ValueError('Invalid PE signature or truncated COFF header')
    machine, count = struct.unpack_from('<HH', data, pe + 4)
    size = struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    table = optional + size
    if machine != 0x8664 or size < 112 or table + count * 40 > len(data):
        raise ValueError('Expected complete x86-64 PE32+ headers')
    if struct.unpack_from('<H', data, optional)[0] != 0x20b:
        raise ValueError('Expected PE32+ optional header')
    base = struct.unpack_from('<Q', data, optional + 24)[0]
    sections = []
    for index in range(count):
        offset = table + index * 40
        name = bytes(data[offset:offset + 8]).split(b'\0', 1)[0]
        rva = struct.unpack_from('<I', data, offset + 12)[0]
        flags = struct.unpack_from('<I', data, offset + 36)[0]
        sections.append((name, base + rva, flags, offset + 36))
    return sections, optional + 64


def checksum(data, field):
    content = bytearray(data)
    content[field:field + 4] = bytes(4)
    if len(content) % 2:
        content.append(0)
    words = array('H')
    words.frombytes(content)
    if sys.byteorder != 'little':
        words.byteswap()
    total = sum(words)
    while total >> 16:
        total = (total & 0xffff) + (total >> 16)
    return (total + len(data)) & 0xffffffff


def normalize(data):
    sections, checksum_field = headers(data)
    seen_writable = False
    output = None
    for name, address, flags, field in sections:
        if address < CODE_ADDRESS or flags & DISCARD:
            continue
        if name == b'.idata' and seen_writable and not flags & WRITE:
            if not flags & READ or flags & EXECUTE:
                raise ValueError('Unexpected import section permissions')
            output = bytearray(data)
            struct.pack_into('<I', output, field, flags | WRITE)
            struct.pack_into('<I', output, checksum_field, checksum(output, checksum_field))
            break
        if flags & WRITE:
            seen_writable = True
    return bytes(output) if output is not None else data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('executable', type=Path)
    executable = parser.parse_args().executable
    before = executable.read_bytes()
    after = normalize(before)
    if after != before:
        executable.write_bytes(after)
        print('Normalized native PE .idata permissions; layout validation remains enabled')


if __name__ == '__main__':
    main()
