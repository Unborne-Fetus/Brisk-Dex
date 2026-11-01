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
        if '#include <stdio.h>' in data and '#include "brisk_stdio.h"' not in data:
            file.write_text(data.replace('#include <stdio.h>',
                                        '#include <stdio.h>\n#include "brisk_stdio.h"', 1))
    print("Applied MinGW ANSI stdio compatibility (format warnings remain enabled)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    apply(parser.parse_args().source_dir)
