"""Regression checks for the ARM64 GBA libgcc division port."""
from __future__ import annotations

import ctypes
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IR_SOURCE = ROOT / "tools" / "rewrite_android_division_ir.py"
DIV_SOURCE = ROOT / "android-native" / "src" / "gba_division_android.c"
spec = importlib.util.spec_from_file_location("brisk_division_ir", IR_SOURCE)
ir = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ir)


class AndroidDivision(unittest.TestCase):
    def test_ir_rewrites_all_four_operations_without_changing_metadata(self):
        sample = (
            "source_filename = \"example.c\"\n"
            "define i32 @test(i32 %a, i32 %b) {\n"
            "entry:\n"
            "  %q = sdiv i32 %a, %b, !dbg !4\n"
            "  %r = srem i32 %a, %b\n"
            "  %x = udiv i32 %a, %b\n"
            "  %z = urem i32 %a, %b\n"
            "  ret i32 %q\n}\n"
            "!4 = !{i32 1}\n"
        )
        result, report = ir.transform(sample)
        self.assertEqual(report["rewritten"], 4)
        self.assertIn("%q = call i32 @brisk_gba_sdiv_i32(i32 %a, i32 %b), !dbg !4", result)
        self.assertIn("%r = call i32 @brisk_gba_srem_i32(i32 %a, i32 %b)", result)
        self.assertIn("declare i32 @brisk_gba_udiv_i32(i32, i32)", result)
        self.assertNotIn(" = sdiv ", result)

    def test_nested_llvm_constant_expression_is_not_split_at_inner_comma(self):
        original = (
            "%9 = sdiv i64 sub (i64 167772160, i64 ptrtoint (ptr @__rom_end to i64)), 1024\\n"
            "%10 = udiv i32 %a, %b, !dbg !4\\n"
        ).replace("\\n", "\n")
        converted, report = ir.transform(original)
        self.assertEqual(report["rewritten"], 2)
        self.assertIn(
            "call i64 @brisk_gba_sdiv_i64("
            "i64 sub (i64 167772160, i64 ptrtoint (ptr @__rom_end to i64)), i64 1024)",
            converted,
        )
        self.assertIn("i32 %a, i32 %b), !dbg !4", converted)

    def test_ir_rejects_unsupported_division_sizes(self):
        with self.assertRaisesRegex(ValueError, "unsupported divide"):
            ir.transform("  %q = sdiv i128 %n, %d\n")

    @unittest.skipUnless(shutil.which("cc"), "Host C compiler unavailable")
    def test_apcs_libgcc_reference_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            so = Path(tmp) / "libdivision.so"
            subprocess.run(["cc", "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
                            "-o", str(so), str(DIV_SOURCE)], check=True, capture_output=True)
            library = ctypes.CDLL(str(so))

            def check(name, restype, inputs, vectors):
                fn = getattr(library, name)
                fn.argtypes = [inputs, inputs]
                fn.restype = restype
                for n, d, expected in vectors:
                    self.assertEqual(fn(n, d), expected, f"{name}({n}, {d})")

            check("brisk_gba_udiv_i32", ctypes.c_uint32, ctypes.c_uint32,
                  [(0, 0, 0), (1, 0, 0xFFFFFFFF), (7, 2, 3)])
            check("brisk_gba_urem_i32", ctypes.c_uint32, ctypes.c_uint32,
                  [(0, 0, 0), (1, 0, 0xFFFFFFFF), (7, 2, 1)])
            check("brisk_gba_sdiv_i32", ctypes.c_int32, ctypes.c_int32,
                  [(0, 0, 0), (1, 0, 0x7FFFFFFF),
                   (-5, 0, -0x80000000), (-0x80000000, -1, -0x80000000)])
            check("brisk_gba_srem_i32", ctypes.c_int32, ctypes.c_int32,
                  [(1, 0, 0x7FFFFFFF), (-5, 0, -0x80000000),
                   (-0x80000000, -1, 0), (-7, 2, -1)])
            check("brisk_gba_udiv_i64", ctypes.c_uint64, ctypes.c_uint64,
                  [(0, 0, 1), (1, 0, 3), (2, 0, 7),
                   (0x100000000, 0, 0x3FFFFFFFF), (7, 2, 3)])
            check("brisk_gba_urem_i64", ctypes.c_uint64, ctypes.c_uint64,
                  [(0, 0, 0), (1, 0, 1), (2, 0, 2),
                   (0x100000000, 0, 0), (7, 2, 1)])
            check("brisk_gba_sdiv_i64", ctypes.c_int64, ctypes.c_int64,
                  [(1, 0, 3), (-1, 0, -3),
                   (-0x8000000000000000, -1, -0x8000000000000000)])
            check("brisk_gba_srem_i64", ctypes.c_int64, ctypes.c_int64,
                  [(1, 0, 1), (-1, 0, -1),
                   (-0x8000000000000000, -1, 0)])

    @unittest.skipUnless(shutil.which("clang"), "LLVM IR compiler unavailable")
    def test_real_llvm_ir_round_trip(self):
        source = "int divtest(int a, int b) { return a / b + a % b; }\n"
        with tempfile.TemporaryDirectory() as tmp:
            original = Path(tmp) / "input.ll"
            rewritten = Path(tmp) / "game.ll"
            target = Path(tmp) / "game.o"
            subprocess.run(
                ["clang", "-x", "c", "-O0", "-Xclang", "-disable-O0-optnone",
                 "-S", "-emit-llvm", "-o", str(original), "-"],
                input=source, text=True, check=True, capture_output=True
            )
            result, report = ir.transform(original.read_text())
            self.assertGreaterEqual(report["rewritten"], 2)
            rewritten.write_text(result)
            subprocess.run(["clang", "-c", "-x", "ir", str(rewritten), "-o", str(target)],
                           check=True, capture_output=True)
            self.assertGreater(target.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
