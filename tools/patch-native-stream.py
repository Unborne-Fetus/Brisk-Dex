#!/usr/bin/env python3
"""Apply a minimal, idempotent embedded-frame/input transport to the pinned native platform.
Does not replace expansion gameplay code. Only patches platform/video.c and platform/input.c.
"""
import argparse
from pathlib import Path

VIDEO_ORIGINAL = """    if (cfg->headless) {
        state.initialised = true;
        return 0;
    }"""
VIDEO_UPDATED = """    if (cfg->headless) {
        state.initialised = true;
        state.brisk_stream = getenv("BRISK_FRAME_STREAM") != NULL;
#if defined(_WIN32)
        if (state.brisk_stream && _setmode(_fileno(stdout), _O_BINARY) < 0)
            return -1;
#endif
        if (state.brisk_stream)
            (void)setvbuf(stdout, NULL, _IONBF, 0);
        return 0;
    }"""
PRESENT_ORIGINAL = """    if (state.headless)
        return 0;
    if (SDL_UpdateTexture"""
PRESENT_UPDATED = """    if (state.headless) {
        if (state.brisk_stream) {
            /* Fast-forward advances every game frame but only presents at
             * display rate, so IPC never becomes the speed limiter. */
            static uint32_t last_present;
            const uint32_t now = SDL_GetTicks();
            if ((uint32_t)(now - last_present) < 16u)
                return 0;
            last_present = now;
            const unsigned char header[8] = {'B', 'E', 'X', 'P', 0, 0x2c, 0x01, 0};
            if (fwrite(header, 1, sizeof header, stdout) != sizeof header
                || fwrite(frame, sizeof(uint16_t), VIDEO_PIXEL_COUNT, stdout) != VIDEO_PIXEL_COUNT)
                return -1;
        }
        return 0;
    }
    if (SDL_UpdateTexture"""
INPUT_ORIGINAL = """    if (source == INPUT_SOURCE_HOST) {
        status = init_host();
    } else if (source == INPUT_SOURCE_SCRIPT) {
        status = 0;
    }"""
INPUT_UPDATED = """    if (source == INPUT_SOURCE_HOST) {
        status = init_host();
    } else if (source == INPUT_SOURCE_SCRIPT) {
        status = 0;
        if (getenv("BRISK_FRAME_STREAM") != NULL && !brisk_reader_started) {
            brisk_reader_started = true;
            SDL_Thread *reader = SDL_CreateThread(brisk_read_stdin, "brisk-input", NULL);
            if (reader == NULL) {
                (void)fprintf(stderr, "input: embedded key input thread failed: %s\\n", SDL_GetError());
                brisk_reader_started = false;
                status = -1;
            } else {
                SDL_DetachThread(reader);
            }
        }
    }"""
INPUT_KEYS_ORIGINAL = """    const uint16_t keys = state.source == INPUT_SOURCE_HOST ? read_host_keys() : state.script_keys;
    write_keyinput(overlay_game_keys(keys));"""
INPUT_KEYS_UPDATED = """    const uint16_t keys = state.source == INPUT_SOURCE_HOST ? read_host_keys()
        : brisk_reader_started ? (uint16_t)SDL_AtomicGet(&brisk_keys) : state.script_keys;
    write_keyinput(overlay_game_keys(keys));"""
THREAD_INSERT = """
/* The app owns stdin; a dedicated thread waits for two-byte GBA key masks.
 * No gameplay state or GBA memory is touched from this thread. */
static SDL_atomic_t brisk_keys;
static SDL_atomic_t brisk_options;
unsigned input_brisk_speed(void) { return (unsigned)SDL_AtomicGet(&brisk_options) & 7u; }
bool input_brisk_paused(void) { return (SDL_AtomicGet(&brisk_options) & 8) != 0; }
bool input_brisk_muted(void) { return (SDL_AtomicGet(&brisk_options) & 16) != 0; }
bool input_brisk_active(void) { return getenv("BRISK_FRAME_STREAM") != NULL; }
static bool brisk_reader_started;
static int brisk_read_stdin(void *unused)
{
    (void)unused;
#if defined(_WIN32)
    if (_setmode(_fileno(stdin), _O_BINARY) < 0)
        return 1;
#endif
    unsigned char keys[2];
    SDL_AtomicSet(&brisk_options, 1);
    while (fread(keys, 1, 2, stdin) == 2) {
        unsigned word = keys[0] | ((unsigned)keys[1] << 8);
        unsigned options = word >> 10;
        if ((options & 7u) > 4u) options = (options & ~7u) | 1u;
        SDL_AtomicSet(&brisk_options, (int)options);
        SDL_AtomicSet(&brisk_keys, (int)word & 0x3ff);
    }
    SDL_AtomicSet(&brisk_keys, 0);
    return 0;
}
"""

def swap(source: str, before: str, after: str, name: str) -> str:
    if after in source:
        return source
    if source.count(before) != 1:
        raise RuntimeError(f"{name}: expected one pinned upstream anchor; found {source.count(before)}")
    return source.replace(before, after)

def apply(source_dir: Path) -> None:
    video = source_dir / "platform/video.c"
    data = video.read_text()
    data = swap(data, '#include <stdio.h>', '#include <stdio.h>\n#include <stdlib.h>\n#if defined(_WIN32)\n#include <io.h>\n#include <fcntl.h>\n#endif', "video includes")
    data = swap(data, '    bool headless;\n', '    bool headless;\n    bool brisk_stream;\n', "video state")
    data = swap(data, VIDEO_ORIGINAL, VIDEO_UPDATED, "video init")
    data = swap(data, PRESENT_ORIGINAL, PRESENT_UPDATED, "frame transport")
    video.write_text(data)
    inp = source_dir / "platform/input.c"
    data = inp.read_text()
    data = swap(data, '#include <stdio.h>', '#include <stdio.h>\n#include <stdlib.h>\n#if defined(_WIN32)\n#include <io.h>\n#include <fcntl.h>\n#endif', "input includes")
    data = swap(data, 'static struct {\n', THREAD_INSERT+'\nstatic struct {\n', "input thread")
    data = swap(data, INPUT_ORIGINAL, INPUT_UPDATED, "input init")
    data = swap(data, INPUT_KEYS_ORIGINAL, INPUT_KEYS_UPDATED, "input mask")
    inp.write_text(data)
    frame = source_dir / "platform/frame.c"
    data = frame.read_text()
    declarations = ('#include "input.h"\n#include <SDL.h>\n'
                    'extern unsigned input_brisk_speed(void);\n'
                    'extern bool input_brisk_paused(void);\n'
                    'extern bool input_brisk_muted(void);\n'
                    'extern bool input_brisk_active(void);')
    data = swap(data, '#include "input.h"', declarations, "embedded timing declarations")
    data = swap(data, 'const uint32_t speed = fastforward_multiplier();',
                'const uint32_t speed = input_brisk_active() ? input_brisk_speed() : fastforward_multiplier();', "embedded speed")
    data = swap(data, 'const bool muted = fastforward_muted();',
                'const bool muted = input_brisk_active() ? (input_brisk_muted() || speed == 0) : fastforward_muted();', "embedded mute")
    before = '    run_visible_lines();\n'
    after = ('    while (input_brisk_active() && input_brisk_paused()) {\n'
             '        (void)audio_set_paused(true);\n'
             '        frame.sound_muted = true;\n'
             '        SDL_Delay(10);\n'
             '    }\n' + before)
    data = swap(data, before, after, "embedded pause")
    frame.write_text(data)

def self_test():
    checks = [
        (VIDEO_ORIGINAL, VIDEO_UPDATED),
        (PRESENT_ORIGINAL, PRESENT_UPDATED),
        (INPUT_ORIGINAL, INPUT_UPDATED),
        (INPUT_KEYS_ORIGINAL, INPUT_KEYS_UPDATED),
    ]
    for before, after in checks:
        assert swap("abc" + before + "def", before, after, "test") == "abc" + after + "def"
        assert swap("abc" + after + "def", before, after, "test") == "abc" + after + "def"
    print("Native bridge patch anchors: self-test passed")

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("source_dir",type=Path,nargs="?")
    parser.add_argument("--self-test",action="store_true")
    args=parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if args.source_dir is None:
            parser.error("source_dir is required")
        apply(args.source_dir)
        print("Patched native video frames and input streaming for embedded Brisk Dex")
