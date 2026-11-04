"""Verify Android game ABI adapter is real compiled C, not a synthetic JS screen.

The harness supplies a test main ONLY in a host unit test; the Android core
library is never built or linked with it. Android gameplay requires the full
native Brisk game and on-device acceptance tests.
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PIN=json.loads((ROOT/"tools"/"brisk-native-source.json").read_text())["brisk_commit"]

HARNESS=r'''
#include "brisk_android_core.h"
#include <assert.h>
#include <stdint.h>
#include <string.h>
extern void brisk_android_deliver_frame(const uint16_t *);
extern unsigned brisk_android_stream_speed(void);
extern uint16_t brisk_android_keymask(void);
extern int brisk_android_frame_step(void *);
static int delivered;
static void on_frame(const uint16_t *frame, void *ctx) {
    assert(frame[1]==1);
    delivered++;
    (*(int *)ctx)++;
}
int brisk_android_game_main(int argc, char **argv) {
    assert(argc==4);
    assert(!strcmp(argv[1],"--headless"));
    assert(!strcmp(argv[2],"--data-dir"));
    assert(!strcmp(argv[3],"/tmp/brisk"));
    assert(brisk_android_stream_speed()==4);
    assert(brisk_android_keymask()==0);
    uint16_t pixels[BRISK_ANDROID_PIXELS]={0};
    pixels[1]=1;
    brisk_android_deliver_frame(pixels);
    assert(brisk_android_frame_step(0)==0);
    return 0;
}
int main(void) {
    const brisk_android_core_v1 *api=brisk_android_core_v1_entry();
    assert(api&&api->abi_version==BRISK_ANDROID_CORE_ABI);
    assert(strlen(api->source_commit)==40);
    assert(!strcmp(api->profile,"brisk"));
    assert(api->configure(5,0,0)!=0);
    assert(api->configure(4,0,0)==0);
    int frames=0;
    assert(api->run("/tmp/brisk",on_frame,&frames)==0);
    assert(frames==1 && delivered==1);
    /* A stop scheduled before the next run must cancel that launch. */
    api->stop();
    assert(api->run("/tmp/brisk",on_frame,&frames)==0);
    assert(frames==1 && delivered==1);
    assert(api->configure(4,0,0)==0);
    assert(api->run("/tmp/brisk",on_frame,&frames)==0);
    assert(frames==2 && delivered==2);
    return 0;
}
'''

class GameAdapterTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("cc"),"C compiler unavailable")
    def test_compiled_core_abi_callbacks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            harness=root/"test_core.c"
            harness.write_text(HARNESS)
            binary=root/"test_core"
            args=["cc","-std=gnu17","-Wall","-Wextra","-Werror",
                  '-DBRISK_SOURCE_COMMIT="'+PIN+'"',
                  "-I"+str(ROOT/"android-native/include"),
                  str(ROOT/"android-native/src/game_core_adapter.c"),
                  str(harness),"-o",str(binary)]
            subprocess.run(args,check=True,capture_output=True,text=True)
            subprocess.run([str(binary)],check=True,capture_output=True,text=True)
