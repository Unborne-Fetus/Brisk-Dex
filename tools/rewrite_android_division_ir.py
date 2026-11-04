#!/usr/bin/env python3
"""Rewrite Android game LLVM IR divisions to exact GBA/APCS semantics.

Run on IR generated at -O0 before LLVM optimization. Clang/AArch64 integer
division by zero produces 0, unlike the Emerald GBA's ARM libgcc routines.
The source tree's normal C preprocessing stays unchanged. Only this native
Android port routes instructions through gba_division_android.c.

Fail closed for any unrecognized division, rather than silently change game
mechanics. Does NOT claim a playable library or alter desktop builds.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DIVISION = re.compile(
    r'^(?P<indent>[ \t]*)(?P<target>%(?:[-$._a-zA-Z0-9]+|"[^"]+")) = '
    r'(?P<kind>sdiv|udiv|srem|urem)(?: exact)? i(?P<bits>32|64) '
    r'(?P<arguments>.*)$'
)
POSSIBLE_DIVISION = re.compile(r"\b(?:sdiv|udiv|srem|urem)(?: exact)? i\d+")
HELPERS = {
    (name, bits): f"brisk_gba_{name}_i{bits}"
    for name in ("sdiv", "udiv", "srem", "urem") for bits in (32, 64)
}


def split_division_arguments(arguments: str) -> tuple[str, str, str]:
    """Split at LLVM IR TOP-LEVEL commas, not inside constant expressions.

    Native game code uses nested LLVM constant expressions such as:
      sdiv i64 sub (i64 167772160, i64 ptrtoint (ptr @__rom_end to i64)), 1024
    A simple regex can incorrectly split inside 'sub (..., ...)'.
    """
    commas = []
    depth = 0
    in_string = False
    escaped = False
    for offset, char in enumerate(arguments):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
            if depth < 0:
                raise ValueError("Unbalanced LLVM constant expression")
        elif char == "," and depth == 0:
            commas.append(offset)
    if in_string or depth != 0 or not commas:
        raise ValueError(f"Malformed LLVM division operands: {arguments[:150]}")
    comma = commas[0]
    left = arguments[:comma].strip()
    remainder = arguments[comma + 1:].strip()
    comma2 = next((i for i in commas[1:]), None)
    if comma2 is None:
        return left, remainder, ""
    right = arguments[comma + 1:comma2].strip()
    suffix = arguments[comma2:]
    if not left or not right:
        raise ValueError("Empty LLVM division operand")
    return left, right, suffix

def transform(source: str) -> tuple[str, dict]:
    rewritten = []
    counts = {key: 0 for key in HELPERS}
    for number, line in enumerate(source.splitlines(keepends=True), start=1):
        original = line.rstrip("\r\n")
        match = DIVISION.fullmatch(original)
        if match:
            kind = match["kind"]
            bits = int(match["bits"])
            left, right, suffix = split_division_arguments(match["arguments"])
            replacement = (
                f'{match["indent"]}{match["target"]} = call i{bits} '
                f'@{HELPERS[kind, bits]}(i{bits} {left}, '
                f'i{bits} {right}){suffix}'
            )
            rewritten.append(replacement + line[len(original):])
            counts[(kind, bits)] += 1
        elif not original.lstrip().startswith((";", "!")) and POSSIBLE_DIVISION.search(original):
            raise ValueError(f"Unrecognized or unsupported divide at LLVM IR line {number}: {original[:240]}")
        else:
            rewritten.append(line)
    # LLVM accepts declarations after the metadata definitions; they are
    # external so no runtime replacement of libgcc or the STL occurs.
    declarations = "".join(
        f"\ndeclare i{bits} @{HELPERS[kind, bits]}(i{bits}, i{bits})\n"
        for (kind, bits), n in counts.items() if n
    )
    result = {
        "rewritten": sum(counts.values()),
        "helpers_used": {
            HELPERS[kind, bits]: n for (kind, bits), n in counts.items() if n
        },
    }
    return "".join(rewritten) + declarations, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    converted, report = transform(args.input.read_text())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(converted)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(f'GBA division IR: routed {report["rewritten"]} operations; output={args.output}')


if __name__ == "__main__":
    main()
