import importlib.util
import json
import tempfile
import struct
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/"tools"/"inspect_android_apk.py"
spec=importlib.util.spec_from_file_location("apk_probe",SCRIPT)
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
PIN=json.loads((ROOT/"tools"/"brisk-native-source.json").read_text())["brisk_commit"]

class AndroidArchiveTests(unittest.TestCase):
    @staticmethod
    def arm64_elf():
        header=bytearray(64)
        header[:6]=b"\x7fELF"+bytes([2,1])
        struct.pack_into("<HH",header,16,3,183)
        return bytes(header)

    def make_apk(self,root,core=False,bad_core=False):
        dest=root/"test.apk"
        with ZipFile(dest,"w") as archive:
            archive.writestr("lib/arm64-v8a/libbriskandroid.so",b"native-transport")
            if core:archive.writestr("lib/arm64-v8a/libbriskgame.so",
                b"not-a-game" if bad_core else self.arm64_elf())
        return dest
    def test_transport_only_is_not_playable(self):
        with tempfile.TemporaryDirectory() as temp:
            result=probe.inspect_apk(self.make_apk(Path(temp)),PIN)
            self.assertFalse(result["game_integrated"])
            self.assertEqual(result["missing_game_abis"],["arm64-v8a"])
    def test_core_is_required_for_every_target_abi(self):
        with tempfile.TemporaryDirectory() as temp:
            result=probe.inspect_apk(self.make_apk(Path(temp),core=True),PIN)
            self.assertTrue(result["game_integrated"])
    def test_fake_native_game_is_not_reported_as_integrated(self):
        with tempfile.TemporaryDirectory() as temp:
            result=probe.inspect_apk(self.make_apk(Path(temp),core=True,bad_core=True),PIN)
            self.assertFalse(result["game_integrated"])
            self.assertEqual(result["invalid_game_abis"],["arm64-v8a"])

    def test_reject_wrong_source_pin(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                probe.inspect_apk(self.make_apk(Path(temp)),"0"*40)

if __name__=="__main__":
    unittest.main()
