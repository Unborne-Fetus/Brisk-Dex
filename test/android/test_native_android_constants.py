"""Regression tests for equal absolute assembly symbols in the ARM64 archive."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/android_assemble.py"


@unittest.skipUnless(all(shutil.which(name) for name in ("clang", "nm", "objcopy", "ld.lld")),
                     "requires Clang, binutils and lld")
class AbsoluteConstantTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def assemble(self, name, value):
        source = self.root / (name + ".s")
        obj = self.root / (name + ".o")
        source.write_text(f".globl MOVE_NONE\n.equiv MOVE_NONE, {value}\n"
                          f".text\n.globl {name}\n{name}:\n.word MOVE_NONE\n")
        subprocess.run(["clang", "--target=aarch64-linux-gnu", "-c",
                        str(source), "-o", str(obj)], check=True)
        return obj

    def normalize(self, *objects):
        return subprocess.run([sys.executable, str(SCRIPT),
                               "--normalize-absolute-constants",
                               "--nm", "nm", "--objcopy",
                               shutil.which("llvm-objcopy") or "objcopy",
                               *map(str, objects)], text=True, capture_output=True)

    def test_identical_constants_link_and_real_labels_survive(self):
        if not shutil.which("llvm-objcopy"):
            self.skipTest("requires LLVM objcopy for AArch64")
        a, b = self.assemble("battle_anim", 0), self.assemble("battle_script", 0)
        output = self.root / "game.so"
        link = ["ld.lld", "-shared", str(a), str(b), "-o", str(output)]
        before = subprocess.run(link, capture_output=True, text=True)
        self.assertNotEqual(before.returncode, 0)
        self.assertIn("duplicate symbol: MOVE_NONE", before.stderr)
        result = self.normalize(a, b)
        self.assertEqual(result.returncode, 0, result.stderr)
        subprocess.run(link, check=True)
        symbols = subprocess.check_output(["nm", "--format=posix", str(output)], text=True)
        self.assertIn("battle_anim T ", symbols)
        self.assertIn("battle_script T ", symbols)
        self.assertIn("MOVE_NONE A ", symbols)
        self.assertTrue(output.is_file())

    def test_conflicting_absolute_constants_fail_closed(self):
        a, b = self.assemble("battle_anim", 0), self.assemble("battle_script", 1)
        result = self.normalize(a, b)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Conflicting absolute constant MOVE_NONE", result.stderr)
        for obj in (a, b):
            self.assertIn("MOVE_NONE A ", subprocess.check_output(
                ["nm", "--format=posix", str(obj)], text=True))


    def test_song_relative_jump_and_relro_pointer_table(self):
        if not shutil.which("llvm-objcopy"):
            self.skipTest("requires LLVM objcopy for AArch64")
        song_dir = self.root / "sound" / "songs" / "midi"
        song_dir.mkdir(parents=True)
        song_src = song_dir / "song.s"
        song_src.write_text('.section .rodata,"a",%progbits\n'
                            '.global song_header\nsong_header:\n'
                            '.xword voicegroup\n.xword song_body\n'
                            'song_body:\n.byte 0xb2\n.word song_body\n')
        voice_src = self.root / "voice.s"
        voice_src.write_text(".data\n.global voicegroup\nvoicegroup: .xword 0\n")
        song, voice = song_src.with_suffix(".o"), voice_src.with_suffix(".o")
        for source, obj in ((song_src, song), (voice_src, voice)):
            subprocess.run(["clang", "--target=aarch64-linux-gnu", "-c",
                            str(source), "-o", str(obj)], check=True)
        link = ["ld.lld", "-shared", "-z", "defs", str(song), str(voice),
                "-o", str(self.root / "game.so")]
        before = subprocess.run(link, capture_output=True, text=True)
        self.assertNotEqual(before.returncode, 0)
        self.assertIn("R_AARCH64_ABS32", before.stderr)
        self.assertIn("R_AARCH64_ABS64", before.stderr)
        result = self.normalize(song)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Converted 1 packed song jumps", result.stdout)
        subprocess.run(link, check=True)
        if shutil.which("readelf"):
            dynamic = subprocess.check_output(
                ["readelf", "-dW", str(self.root / "game.so")], text=True)
            self.assertNotIn("TEXTREL", dynamic)
            sections = subprocess.check_output(
                ["readelf", "-SW", str(self.root / "game.so")], text=True)
            self.assertIn(".data.rel.ro", sections)



    def test_cross_object_constants_and_packed_local_global_pointers(self):
        if not shutil.which("llvm-objcopy"):
            self.skipTest("requires LLVM objcopy for AArch64")
        a, b = self.root / "script.o", self.root / "target.o"
        a.with_suffix(".s").write_text(
            '.section script_data,"aw",%progbits\n.global event_script\n'
            'event_script:\n.word target_fn\n.word local_target\n'
            '.hword B_MSG_MON_ANGRY\nlocal_target: .byte 0\n')
        b.with_suffix(".s").write_text(
            '.global B_MSG_MON_ANGRY\n.equiv B_MSG_MON_ANGRY, 7\n'
            '.text\n.global target_fn\ntarget_fn: ret\n')
        for obj in (a, b):
            subprocess.run(["clang", "--target=aarch64-linux-gnu", "-c",
                            str(obj.with_suffix(".s")), "-o", str(obj)], check=True)
        table = self.root / "packed.s"
        result = subprocess.run([sys.executable, str(SCRIPT),
            "--normalize-absolute-constants", "--nm", "nm",
            "--objcopy", shutil.which("llvm-objcopy"),
            "--pointer-table", str(table), str(a), str(b)],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Encoded 2 unique packed game pointers", result.stdout)
        self.assertIn(".quad target_fn +0", table.read_text())
        obj = table.with_suffix(".o")
        subprocess.run(["clang", "--target=aarch64-linux-gnu", "-c",
                        str(table), "-o", str(obj)], check=True)
        output = self.root / "game.so"
        subprocess.run(["ld.lld", "-shared", "-z", "defs", "-z", "text",
                        str(a), str(b), str(obj), "-o", str(output)], check=True)
        if shutil.which("readelf"):
            report = subprocess.check_output(["readelf", "-x", "script_data",
                                              str(output)], text=True)
            self.assertIn("000000f0 010000f0 0700", report)


if __name__ == "__main__":
    unittest.main()
