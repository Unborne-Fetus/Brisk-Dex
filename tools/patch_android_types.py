#!/usr/bin/env python3
"""Remove redundant top-level const on scalar callback returns for Android Clang.

Only rewrites the two pinned overworld-ability callback tables. The function
pointers themselves remain const; this changes no function behavior.
"""
import argparse
from pathlib import Path

OLD='static const bool32 (*const '
NEW='static bool32 (*const '

def patch(root):
    file=Path(root)/'src'/'ow_abilities.c'
    data=file.read_text()
    if OLD not in data and data.count(NEW)==2:
        return False
    if data.count(OLD)!=2:
        raise RuntimeError('Android callback signatures: pinned source mismatch')
    file.write_text(data.replace(OLD,NEW))
    return True

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    args=parser.parse_args()
    print('Normalized Android overworld callback types' if patch(args.source)
          else 'Android overworld callback types already normalized')
