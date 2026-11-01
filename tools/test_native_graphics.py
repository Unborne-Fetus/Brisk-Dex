#!/usr/bin/env python3
"""Compile the real native DMA manager against memory-copy hooks, without game assets."""
import argparse
import subprocess
import tempfile
from pathlib import Path


def test(source):
    with tempfile.TemporaryDirectory(prefix='brisk-graphics-') as tmp:
        root = Path(tmp)
        (root / 'global.h').write_text('''#include <stdint.h>
#include <string.h>
typedef uint8_t u8; typedef int16_t s16; typedef uint16_t u16;
typedef uint32_t u32; typedef int32_t s32; typedef volatile uint8_t vbool8;
#define TRUE 1
#define FALSE 0
#define INCREMENT_OR_WRAP(n,max) (((n)+1)%(max))
static u8 test_vcount=160;
#define REG_ADDR_VCOUNT (&test_vcount)
''')
        (root / 'dma3.h').write_text('''#define Dma3CopyLarge16_(s,d,n) memcpy(d,s,n)
#define Dma3CopyLarge32_(s,d,n) memcpy(d,s,n)
static void fill32(u32 v,void *d,u32 n){for(u32 i=0;i<n;i+=4)memcpy((u8*)d+i,&v,4);}
static void fill16(u32 v,void *d,u32 n){u16 x=v;for(u32 i=0;i<n;i+=2)memcpy((u8*)d+i,&x,2);}
#define Dma3FillLarge16_(v,d,n) fill16(v,d,n)
#define Dma3FillLarge32_(v,d,n) fill32(v,d,n)
''')
        harness = '''
#include <assert.h>
int main(void){
 static u8 tiles[49152],vram[49152];
 memset(tiles,0xa5,sizeof tiles);ClearDma3Requests();
 assert(RequestDma3Copy(tiles,vram,sizeof tiles,1)>=0);
 ProcessDma3Requests();assert(memcmp(tiles,vram,sizeof tiles)==0);
 for(int i=0;i<200;i++){u16 glyph=(u16)(i+1);assert(RequestDma3Copy(&glyph,vram+i*2,2,0)>=0);}
 for(int i=0;i<200;i++){u16 got;memcpy(&got,vram+i*2,2);assert(got==i+1);}
 assert(RequestDma3Fill(0x12121212,vram,sizeof vram,1)>=0);
 for(unsigned i=0;i<sizeof vram;i++)assert(vram[i]==0x12);
 assert(RequestDma3Copy(tiles,vram,0,1)>=0);
 return 0;
}
'''
        (root / 'test.c').write_text(source.read_text() + harness)
        subprocess.run(['gcc','-std=gnu17','-DBRISK_NATIVE=1','-O2','-Wall','-Wextra','-Werror','-I',str(root),str(root/'test.c'),'-o',str(root/'test')],check=True)
        subprocess.run([str(root/'test')],check=True)
    print('Native background uploads: 48 KiB transfer, 200 temporary glyph buffers, fills and zero-length guard passed')



def test_tilemap_bounds(source):
    import re
    function = re.search(r'bool32 IsTileMapOutsideWram\(u32 bg\)\n\{.*?\n\}', source.read_text(), re.S).group(0)
    with tempfile.TemporaryDirectory(prefix='brisk-tilemap-') as tmp:
        root = Path(tmp)
        code = r'''
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <assert.h>
typedef uint32_t bool32; typedef uint32_t u32;
#define TRUE 1
#define FALSE 0
#define IWRAM_END 0x03008000
#define TRANSFER_WRITE 1
static unsigned char native_heap[0x1000];
static struct {void *tilemap;} sGpuBgConfigs2[4];
static bool transfer_bounds_ok(uintptr_t address,size_t length,int access){
 return access==TRANSFER_WRITE&&length==1&&address>=(uintptr_t)native_heap&&address<(uintptr_t)(native_heap+sizeof native_heap);
}
'''
        code += function + r'''
int main(void){
 sGpuBgConfigs2[0].tilemap=native_heap+32;assert(!IsTileMapOutsideWram(0));
 sGpuBgConfigs2[0].tilemap=NULL;assert(IsTileMapOutsideWram(0));
 sGpuBgConfigs2[0].tilemap=(void*)0x08000000;assert(IsTileMapOutsideWram(0));
 sGpuBgConfigs2[0].tilemap=native_heap+sizeof native_heap;assert(IsTileMapOutsideWram(0));
 return 0;
}
'''
        (root/'bounds.c').write_text(code)
        subprocess.run(['gcc','-std=gnu17','-DBRISK_NATIVE=1','-O2','-Wall','-Wextra','-Werror',str(root/'bounds.c'),'-o',str(root/'bounds')],check=True)
        subprocess.run([str(root/'bounds')],check=True)
    print('Native tilemaps accept writable native-heap buffers and reject NULL, ROM and out-of-bounds addresses')

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    source = parser.parse_args().source
    test(source)
    test_tilemap_bounds(source.with_name('bg.c'))
