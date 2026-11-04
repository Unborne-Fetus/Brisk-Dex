#!/usr/bin/env python3
"""Route Brisk's VBlank wait through the synchronous native host.

On the GBA, the wireless branch can busy-wait for the hardware interrupt.
On Windows/Linux/Android the simulated interrupt is raised only when
VBlankIntrWait pumps the next host frame. Busy-waiting deadlocks after maps
or link state set gWirelessCommType to a nonzero value.
"""
import argparse
from pathlib import Path

BEFORE = """    if (gWirelessCommType != 0)
    {
        // Desynchronization may occur if wireless adapter is connected
        // and we call VBlankIntrWait();
        while (!(gMain.intrCheck & INTR_FLAG_VBLANK))
            ;
    }
    else
    {
        VBlankIntrWait();
    }"""
AFTER = """#if PLATFORM_NATIVE
    // Native hosts generate VBlank only when VBlankIntrWait runs their frame.
    // The wireless busy-loop would spin forever with no hardware IRQ thread.
    VBlankIntrWait();
#else
""" + BEFORE + """
#endif"""

def patch(root: Path) -> bool:
    source = Path(root) / "src" / "main.c"
    text = source.read_text(encoding="utf-8")
    if AFTER in text:
        if text.count(AFTER) != 1:
            raise RuntimeError("Native VBlank patch duplicated in Brisk source")
        return False
    if text.count(BEFORE) != 1:
        raise RuntimeError("Native VBlank source mismatch: refusing to modify unknown game revision")
    source.write_text(text.replace(BEFORE, AFTER), encoding="utf-8")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    print("Patched Brisk wireless VBlank wait for native hosts"
          if patch(args.source) else "Native Brisk VBlank wait already patched")
