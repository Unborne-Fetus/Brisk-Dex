#!/usr/bin/env python3
"""Regress heap/sprite lifetime bugs in the Brisk nine-starter case."""
import re
import sys
from pathlib import Path

source=Path(sys.argv[1]).read_text()

def section(header):
    begin=source.find(header)
    if begin<0:
        raise RuntimeError('Missing Birch case cleanup: '+header)
    block=source[begin:]
    brace=block.find('{')
    depth=0
    for i in range(brace,len(block)):
        if block[i]=='{':
            depth+=1
        if block[i]=='}':
            depth-=1
            if depth==0:
                return block[:i+1]
    raise RuntimeError('Unterminated Birch case function: '+header)

cleanup=section('static void BirchCaseFreeResources(void)\n')
cursor=section('static void DestroyHandSprite()')
balls=section('static void DestroyPokeballSprites()')
init=section('void BirchCase_Init(MainCallback callback)')
expected=['DestroyHandSprite();','DestroyPokeballSprites();','try_free(sBirchCaseDataPtr);']
for call in expected:
    if cleanup.count(call)!=1:
        raise RuntimeError('Missing or repeated Birch cleanup operation: '+call)
if not cleanup.index('DestroyHandSprite();')<cleanup.index('DestroyPokeballSprites();')<cleanup.index('try_free(sBirchCaseDataPtr);'):
    raise RuntimeError('Birch menu state is freed before the sprites that reference it')
if 'sBirchCaseDataPtr->pokeballSpriteIds[' in cursor or 'sBirchCaseDataPtr->handSpriteId' not in cursor:
    raise RuntimeError('Birch hand cleanup destroys Poké Ball sprites instead of hand sprite')
if not re.search(r'pokeballSpriteIds\[i\]\s*!=\s*SPRITE_NONE',balls):
    raise RuntimeError('Birch attempts to destroy nonexistent ball sprites')
if 'sBirchCaseDataPtr->monSpriteId = SPRITE_NONE;' not in init:
    raise RuntimeError('Uninitialized preview sprite may destroy sprite slot zero')
if not re.search(r'if\s*\(sBirchCaseDataPtr->monSpriteId\s*!=\s*SPRITE_NONE\)',cleanup):
    raise RuntimeError('Birch cleanup may destroy invalid preview sprite')
print('Birch nine-starter case: sprite lifetime, allocation guards, and free order are valid')
