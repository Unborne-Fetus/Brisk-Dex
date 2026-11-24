"""Exercise Android crt0 section boundaries with a real strict AArch64 link."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(all(shutil.which(x) for x in ("clang", "llvm-objcopy", "ld.lld", "readelf")),
                     "requires clang, llvm-objcopy, lld and readelf")
class AndroidResetLayoutTest(unittest.TestCase):
    def test_game_reset_excludes_platform_and_const_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            game = root / "game.c"
            game.write_text(
                'int game_data=3; int game_bss; '
                'int game_small __attribute__((section(".sbss"))); '
                'int game_init __attribute__((section(".ewram")))=2; '
                'int game_common __attribute__((section("common_data"))); '
                'const int *const game_const=&game_data;')
            host = root / "host.c"
            names = ["game_data_start", "game_data_end", "game_bss_start",
                     "game_bss_objects_end", "game_bss_end",
                     "gba_linked_ewram_init_start", "gba_linked_ewram_init_end",
                     "__start_tests", "__stop_tests"]
            host.write_text('int host_data=1; int host_bss; '
                            + ''.join('extern char %s[];' % n for n in names)
                            + 'void *boundaries[]={' + ','.join(names) + '};')
            for src in (game, host):
                subprocess.run(["clang", "--target=aarch64-linux-gnu", "-fPIC",
                                "-fdata-sections", "-c", str(src), "-o",
                                str(src.with_suffix(".o"))], check=True)
            subprocess.run([sys.executable, str(ROOT / "tools/android_assemble.py"),
                            "--mark-game-reset-sections", "--objcopy", "llvm-objcopy",
                            str(game.with_suffix(".o"))], check=True)
            output = root / "game.so"
            subprocess.run(["ld.lld", "-shared", "-z", "defs", "-z", "text",
                            "-T", str(ROOT / "android-native/game-reset-android.ld"),
                            str(game.with_suffix(".o")), str(host.with_suffix(".o")),
                            "-o", str(output)], check=True)
            report = subprocess.check_output(["readelf", "-sW", str(output)], text=True)
            symbols = {}
            for line in report.splitlines():
                parts = line.split()
                if len(parts) >= 8 and parts[0].endswith(":"):
                    symbols[parts[7]] = int(parts[1], 16)
            for name in ("game_bss", "game_small", "game_common"):
                self.assertLessEqual(symbols["game_bss_start"], symbols[name])
                self.assertLess(symbols[name], symbols["game_bss_end"])
            self.assertLessEqual(symbols["game_data_start"], symbols["game_data"])
            self.assertLess(symbols["game_data"], symbols["game_data_end"])
            self.assertLessEqual(symbols["gba_linked_ewram_init_start"], symbols["game_init"])
            self.assertLess(symbols["game_init"], symbols["gba_linked_ewram_init_end"])
            for name in ("host_data", "host_bss", "game_const"):
                for kind in ("data", "bss"):
                    self.assertFalse(symbols["game_"+kind+"_start"] <= symbols[name] <
                                     symbols["game_"+kind+"_end"])
            self.assertEqual(symbols["__start_tests"], symbols["__stop_tests"])


if __name__ == "__main__":
    unittest.main()
