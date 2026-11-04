#!/usr/bin/env python3
"""Android-only replacement for GBA Thumb debug traps in pinned Brisk C code.

The 0xEFFF .hword is a 16-bit GBA instruction; embedding it in 64-bit Android
LLVM IR causes a misaligned AArch64 relocation. Keep GBA/desktop behavior as-is.
"""
import argparse
from pathlib import Path

OLD='        asm(".hword 0xEFFF");'
NEW='''#ifdef BRISK_ANDROID
        __builtin_trap();
#else
        asm(".hword 0xEFFF");
#endif'''

def patch(root):
    file=Path(root)/'src'/'libisagbprn.c'
    text=file.read_text()
    if NEW in text:
        if text.count(NEW)!=3:
            raise RuntimeError("Android GBA trap patch: incomplete source migration")
        return False
    if text.count(OLD)!=3:
        raise RuntimeError("Android GBA trap patch: pinned source mismatch")
    file.write_text(text.replace(OLD,NEW))
    return True

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    args=parser.parse_args()
    print('Patched GBA debug traps for Android' if patch(args.source)
          else 'Android GBA debug traps already patched')
