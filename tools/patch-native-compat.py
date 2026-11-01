#!/usr/bin/env python3
"""Keep the pinned platform compatible with older WSL MinGW toolchains."""
import argparse
from pathlib import Path


def apply(source_dir: Path) -> None:
    platform = source_dir / "platform"
    if not (platform / "bios_internal.c").is_file():
        raise RuntimeError("Pinned native platform sources not found")
    header = Path(__file__).with_name("native-stdio.h").read_text()
    destination = platform / "brisk_stdio.h"
    if not destination.exists() or destination.read_text() != header:
        destination.write_text(header)
    # Only the host platform's C code needs this adapter; leave gameplay alone.
    for file in sorted(platform.glob("*.c")):
        data = file.read_text()
        original = data
        if '#include <stdio.h>' in data and '#include "brisk_stdio.h"' not in data:
            data = data.replace('#include <stdio.h>',
                                '#include <stdio.h>\n#include "brisk_stdio.h"', 1)
        # Custom variadic loggers also need GNU checking on older MinGW.
        # Their implementations use the GNU stdio adapter above.
        data = data.replace('format(printf,', 'format(gnu_printf,')
        if data != original:
            file.write_text(data)
    target_make = platform / "target.mk"
    if target_make.exists():
        data = target_make.read_text()
        before = 'TARGET_CFLAGS := -mno-ms-bitfields -D__USE_MINGW_ANSI_STDIO=1'
        after = 'TARGET_CFLAGS := -mno-ms-bitfields -D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00 -D__USE_MINGW_ANSI_STDIO=1'
        if after not in data:
            if data.count(before) != 1:
                raise RuntimeError("target.mk: pinned Windows flags anchor changed")
            target_make.write_text(data.replace(before, after))
    # Windows conversion checks should not require a macOS-capable assembler.
    # Keep every COFF round-trip, mutation, and real-object check intact.
    checker = platform / "build_glue/check_flat.py"
    if checker.exists():
        data = checker.read_text()
        marker = '    # Brisk: assemble only the requested host format in Windows builds.\n'
        if marker not in data:
            before = '    listings = {target_name: convert("a.o", obj, target_name, values)[0] for target_name in TARGETS}\n'
            after = (marker +
                     '    selected_targets = [name for name in TARGETS if os.environ.get("BRISK_NATIVE_TARGET") != "windows" or name == "coff-x86_64"]\n' +
                     '    listings = {target_name: convert("a.o", obj, target_name, values)[0] for target_name in selected_targets}\n')
            if data.count(before) != 1:
                raise RuntimeError("check_flat: pinned target-selection anchor changed")
            data = data.replace(before, after)
            before = '    for target_name, edits in (("macho-x86_64", MACHO_EDITS), ("coff-x86_64", COFF_EDITS)):\n'
            if data.count(before) != 1:
                raise RuntimeError("check_flat: pinned edit-test anchor changed")
            data = data.replace(before, before + '        if target_name not in listings:\n            continue\n')
            checker.write_text(data)
    macho = platform / "build_glue/macho_object.py"
    if macho.exists():
        data = macho.read_text()
        before = 'def self_test():\n    failures = []\n'
        after = ('def self_test():\n'
                 '    if os.environ.get("BRISK_NATIVE_TARGET") == "windows":\n'
                 '        print("Mach-O assembler tests are not applicable to the Windows COFF build")\n'
                 '        return 0\n'
                 '    failures = []\n')
        if after not in data:
            if data.count(before) != 1:
                raise RuntimeError("macho_object: pinned self-test anchor changed")
            macho.write_text(data.replace(before, after))
    makefile = source_dir / "Makefile.native"
    if makefile.exists():
        helper = platform / "build_glue/brisk_pe_imports.py"
        helper_text = Path(__file__).with_name("native_pe_imports.py").read_text()
        if not helper.exists() or helper.read_text() != helper_text:
            helper.write_text(helper_text)
        data = makefile.read_text()
        command = '\t$(if $(filter windows,$(TARGET_OS)),$(PYTHON) -I platform/build_glue/brisk_pe_imports.py $@)\n'
        if command not in data:
            anchor = '\t$(NATIVE_EXE_CHECK)\n'
            if data.count(anchor) != 1:
                raise RuntimeError("Makefile.native: pinned PE validation anchor changed")
            data = data.replace(anchor, command + anchor)
        before = '$(NATIVE_LINKER_SCRIPTS) | check-palette-padding'
        after = '$(NATIVE_LINKER_SCRIPTS) $(if $(filter windows,$(TARGET_OS)),platform/build_glue/brisk_pe_imports.py) | check-palette-padding'
        if after not in data:
            if data.count(before) != 1:
                raise RuntimeError("Makefile.native: pinned executable dependency anchor changed")
            data = data.replace(before, after)
        if data != makefile.read_text():
            makefile.write_text(data)
    # Desktop embedding should follow the computer's current time zone at
    # every launch, including after daylight-saving or time-zone changes.
    # Deterministic --rtc-fixed replay mode stays unchanged.
    rtc = platform / "rtc.c"
    if rtc.is_file():
        data = rtc.read_text()
        before = '    chip.source = source != NULL ? source : system_clock;\n    if (!found) {\n'
        after = ('    chip.source = source != NULL ? source : system_clock;\n'
                 '    if (getenv("BRISK_FRAME_STREAM") != NULL && seed_from_host_zone)\n'
                 '        found = 0;  /* seed a fresh host-local RTC offset on launch */\n'
                 '    if (!found) {\n')
        if after not in data:
            if data.count(before) != 1:
                raise RuntimeError("rtc.c: pinned host-clock initialization anchor changed")
            data = data.replace(before, after)
        if '#include <stdlib.h>' not in data:
            include = '#include <time.h>\n'
            if data.count(include) != 1:
                raise RuntimeError("rtc.c: missing time header")
            data = data.replace(include, include + '#include <stdlib.h>\n')
        if data != rtc.read_text():
            rtc.write_text(data)
    print("Applied native compiler and PE layout compatibility (validation remains enabled)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    apply(parser.parse_args().source_dir)
