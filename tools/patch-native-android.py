#!/usr/bin/env python3
"""Attach Android callback entry points to the pinned, fully merged Brisk C engine.

Run after prepare_brisk_native.py, patch-native-compat.py, patch-native-stream.py.
Does not alter the desktop game and does not compile the ARM platform itself.
"""
import argparse
from pathlib import Path

def replace_once(text, before, after, label):
    if after in text: return text
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: pinned native source mismatch ({count} anchors)")
    return text.replace(before, after)

def patch(root):
    platform = root / "platform"
    path = platform / "video.c"
    text = path.read_text()
    text = replace_once(text, '#include <stdio.h>',
        '#include <stdio.h>\n#ifdef BRISK_ANDROID\n'
        'extern void brisk_android_deliver_frame(const uint16_t *frame);\n#endif',
        "Android frame callback")
    text = replace_once(text,
        '    if (state.headless) {\n        if (state.brisk_stream) {',
        '    if (state.headless) {\n#ifdef BRISK_ANDROID\n'
        '        brisk_android_deliver_frame(frame);\n#endif\n'
        '        if (state.brisk_stream) {', "Android native video")
    path.write_text(text)

    path = platform / "input.c"
    text = path.read_text()
    text = replace_once(text, '#include <stdio.h>',
        '#include <stdio.h>\n#ifdef BRISK_ANDROID\n'
        'extern uint16_t brisk_android_keymask(void);\n'
        'extern unsigned brisk_android_stream_speed(void);\n'
        'extern bool brisk_android_is_paused(void);\n'
        'extern bool brisk_android_is_muted(void);\n#endif',
        "Android input callbacks")
    base = '''unsigned input_brisk_speed(void) { return (unsigned)SDL_AtomicGet(&brisk_options) & 7u; }
bool input_brisk_paused(void) { return (SDL_AtomicGet(&brisk_options) & 8) != 0; }
bool input_brisk_muted(void) { return (SDL_AtomicGet(&brisk_options) & 16) != 0; }
bool input_brisk_active(void) { return getenv("BRISK_FRAME_STREAM") != NULL; }'''
    android = '''#ifdef BRISK_ANDROID
unsigned input_brisk_speed(void) { return brisk_android_stream_speed(); }
bool input_brisk_paused(void) { return brisk_android_is_paused(); }
bool input_brisk_muted(void) { return brisk_android_is_muted(); }
bool input_brisk_active(void) { return true; }
#else
''' + base + '''
#endif'''
    text = replace_once(text, base, android, "Android native control options")
    base = '''    const uint16_t keys = state.source == INPUT_SOURCE_HOST ? read_host_keys()
        : brisk_reader_started ? (uint16_t)SDL_AtomicGet(&brisk_keys) : state.script_keys;
    write_keyinput(overlay_game_keys(keys));'''
    android = '''#ifdef BRISK_ANDROID
    const uint16_t keys = state.source == INPUT_SOURCE_HOST ? read_host_keys() : brisk_android_keymask();
#else
''' + base + '''
#endif'''
    text = replace_once(text, base, android, "Android native keys")
    path.write_text(text)

    # The existing desktop frame stream pauses before its frame step hook.
    # Android must be allowed to stop even while paused, or JNI shutdown hangs.
    path = platform / "frame.c"
    text = path.read_text()
    text = replace_once(text, '#include "input.h"',
        '#include "input.h"\n#ifdef BRISK_ANDROID\n'
        'extern bool brisk_android_stop_requested(void);\n#endif',
        "Android paused-stop declaration")
    paused = '    while (input_brisk_active() && input_brisk_paused()) {'
    patched = '''#ifdef BRISK_ANDROID
    while (input_brisk_active() && input_brisk_paused() && !brisk_android_stop_requested()) {
#else
''' + paused + '''
#endif'''
    text = replace_once(text, paused, patched, "Android paused-stop handling")
    path.write_text(text)

    path = platform / "main.c"
    text = path.read_text()
    text = replace_once(text, '#include "frame.h"',
        '#include "frame.h"\n#ifdef BRISK_ANDROID\n'
        'extern int brisk_android_frame_step(void *context);\n'
        'static enum frame_step_result brisk_android_step(void *context)\n'
        '{ return (enum frame_step_result)brisk_android_frame_step(context); }\n#endif',
        "Android frame-stop callback")
    text = replace_once(text, '    return frame_init(&config);',
        '    const int status = frame_init(&config);\n'
        '#ifdef BRISK_ANDROID\n'
        '    if (status == 0) frame_set_step_hook(brisk_android_step, NULL);\n'
        '#endif\n'
        '    return status;', "Android frame-stop integration")
    path.write_text(text)
    # Clang for Android/AArch64 cannot lower GCC's five-word
    # __builtin_setjmp buffer. Bionic setjmp requires a real jmp_buf.
    # Keep the desktop/GBA layout unchanged; ScriptEffectContext is
    # local to script.c and never serialized into a save file.
    path = root / "src" / "script.c"
    text = path.read_text()
    text = replace_once(text, '#include "script.h"',
        '#include "script.h"\n#ifdef BRISK_ANDROID\n#include <setjmp.h>\n#endif',
        "AArch64 script nonlocal-jump header")
    text = replace_once(text, '    intptr_t breakTo[5];',
        '#ifdef BRISK_ANDROID\n    jmp_buf breakTo;\n#else\n    intptr_t breakTo[5];\n#endif',
        "Android script jump buffer")
    text = replace_once(text,
        '    if (__builtin_setjmp(gScriptEffectContext->breakTo) == 0)',
        '    if (BRISK_EFFECT_SETJMP(gScriptEffectContext->breakTo) == 0)',
        "Android script effect setjmp")
    old = '__builtin_longjmp(gScriptEffectContext->breakTo, 1);'
    new = 'BRISK_EFFECT_LONGJMP(gScriptEffectContext->breakTo);'
    if text.count(old) != 2 and text.count(new) != 2:
        raise RuntimeError("Android script longjmp: pinned native source mismatch")
    text = text.replace(old, new)
    text = replace_once(text, 'struct ScriptEffectContext {',
        '#ifdef BRISK_ANDROID\n'
        '#define BRISK_EFFECT_SETJMP(buf) setjmp(buf)\n'
        '#define BRISK_EFFECT_LONGJMP(buf) longjmp((buf), 1)\n'
        '#else\n'
        '#define BRISK_EFFECT_SETJMP(buf) __builtin_setjmp(buf)\n'
        '#define BRISK_EFFECT_LONGJMP(buf) __builtin_longjmp((buf), 1)\n'
        '#endif\n'
        'struct ScriptEffectContext {',
        "Android script effect jump functions")
    path.write_text(text)
    # The desktop build's bit 25 tag is ambiguous under Android ASLR.
    # AArch64 functions are 4-byte aligned, leaving low bit 0 available.
    path = platform / "script_tag.h"
    text = path.read_text()
    text = replace_once(text, "#define SCRIPT_TAG UINT32_C(0x02000000)",
        "#ifdef BRISK_ANDROID\n#define SCRIPT_TAG ((uintptr_t)1)\n"
        "#else\n#define SCRIPT_TAG UINT32_C(0x02000000)\n#endif",
        "Android ASLR-safe native function tag")
    path.write_text(text)

    # Tag only 64-bit C function-pointer tables. Embedded 32-bit event
    # bytecode still needs a distinct ARM64 pointer-relocation solution.
    for relative, label, original in (
        ("data/script_cmd_table.inc", "script commands",
         r".8byte \value + ROM_SIZE"),
        ("data/specials.inc", "special commands",
         r".8byte \ptr + ROM_SIZE"),
    ):
        table = root / relative
        text = table.read_text()
        changed = (
            ".ifdef BRISK_ANDROID_ASM\n"
            + original.replace("ROM_SIZE", "1")
            + "\n.else\n" + original
            + "\n.endif"
        )
        text = replace_once(text, original, changed, "Android " + label + " tagged pointer table")
        table.write_text(text)

    print("Installed Brisk Android callbacks, ARM64 jumps and ASLR-safe 64-bit command-table tags.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    patch(args.source)
