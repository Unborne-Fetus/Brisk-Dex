import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[2]/"tools"/"patch-native-android.py"
spec=importlib.util.spec_from_file_location("native_android",SCRIPT)
native=importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

class NativeSourcePatch(unittest.TestCase):
    def fixture(self,root):
        p=root/"platform"
        p.mkdir()
        (p/"video.c").write_text(
            '#include <stdio.h>\n    if (state.headless) {\n        if (state.brisk_stream) {\n')
        (p/"input.c").write_text('''#include <stdio.h>
unsigned input_brisk_speed(void) { return (unsigned)SDL_AtomicGet(&brisk_options) & 7u; }
bool input_brisk_paused(void) { return (SDL_AtomicGet(&brisk_options) & 8) != 0; }
bool input_brisk_muted(void) { return (SDL_AtomicGet(&brisk_options) & 16) != 0; }
bool input_brisk_active(void) { return getenv("BRISK_FRAME_STREAM") != NULL; }
    const uint16_t keys = state.source == INPUT_SOURCE_HOST ? read_host_keys()
        : brisk_reader_started ? (uint16_t)SDL_AtomicGet(&brisk_keys) : state.script_keys;
    write_keyinput(overlay_game_keys(keys));
''')
        (p/"script_tag.h").write_text(
            "#include <stdint.h>\n#define SCRIPT_TAG UINT32_C(0x02000000)\n")
        data = root / "data"
        data.mkdir()
        (data / "script_cmd_table.inc").write_text(r".8byte \value + ROM_SIZE" + "\n")
        (data / "specials.inc").write_text(r".8byte \ptr + ROM_SIZE" + "\n")
        (p/"frame.c").write_text('#include "input.h"\n'
            '    while (input_brisk_active() && input_brisk_paused()) {\n')
        (p/"main.c").write_text('#include "frame.h"\n    return frame_init(&config);\n')
        script=root/"src"
        script.mkdir()
        (script/"script.c").write_text(
            '#include "script.h"\n'
            'struct ScriptEffectContext {\n'
            '    intptr_t breakTo[5];\n'
            '};\n'
            '    if (__builtin_setjmp(gScriptEffectContext->breakTo) == 0)\n'
            '    __builtin_longjmp(gScriptEffectContext->breakTo, 1);\n'
            '    __builtin_longjmp(gScriptEffectContext->breakTo, 1);\n')
        return p

    def test_hooks_and_idempotence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            p=self.fixture(root)
            native.patch(root)
            result={f.name:f.read_text() for f in p.iterdir()}
            self.assertIn("brisk_android_deliver_frame(frame)",result["video.c"])
            self.assertIn("brisk_android_keymask()",result["input.c"])
            self.assertIn("frame_set_step_hook(brisk_android_step",result["main.c"])
            self.assertIn("!brisk_android_stop_requested()",result["frame.c"])
            self.assertIn("#define SCRIPT_TAG ((uintptr_t)1)", result["script_tag.h"])
            self.assertIn(r".8byte \value + 1", (root/"data/script_cmd_table.inc").read_text())
            self.assertIn(r".8byte \ptr + 1", (root/"data/specials.inc").read_text())
            script=(root/"src"/"script.c").read_text()
            self.assertIn("jmp_buf breakTo;",script)
            self.assertIn("BRISK_EFFECT_SETJMP",script)
            self.assertEqual(script.count("BRISK_EFFECT_LONGJMP(gScriptEffectContext->breakTo);"),2)
            native.patch(root)
            self.assertEqual(result,{f.name:f.read_text() for f in p.iterdir()})
            self.assertEqual(script,(root/"src"/"script.c").read_text())
            self.assertEqual((root/"data/script_cmd_table.inc").read_text().count(".ifdef BRISK_ANDROID"), 1)
            self.assertEqual((root/"data/specials.inc").read_text().count(".ifdef BRISK_ANDROID"), 1)
    def test_reject_unreviewed_native_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            p=self.fixture(root)
            (p/"input.c").write_text('#include <stdio.h>\n')
            with self.assertRaisesRegex(RuntimeError,"source mismatch"):
                native.patch(root)
