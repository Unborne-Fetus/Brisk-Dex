#!/usr/bin/env python3
"""Embed a compressed, portable Brisk Dex reference index into a GBA ROM.

This preserves the ROM's executable content. The index occupies only proven
trailing 0xFF padding, or grows the ROM to a valid power-of-two size (<=32 MiB).
The game never reads these bytes; Brisk Dex detects the footer independently.
No external network access or Python dependencies are required.
"""
import argparse
import base64
import json
import pathlib
import struct
import zlib

MAGIC = b"BDXROM2!"
MAX_ROM = 32 * 1024 * 1024
MAX_PACK = 24 * 1024 * 1024

def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def collect_icons(folder):
    icons, shiny = {}, {}
    if folder and folder.is_dir():
        for file in sorted(folder.glob("*.png")):
            stem = file.stem
            is_shiny = stem.endswith("_shiny")
            number = stem[:-6] if is_shiny else stem
            if not number.isdecimal() or not 0 < int(number) <= 4096:
                continue
            content = file.read_bytes()
            if content[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError("Invalid PNG: " + str(file))
            (shiny if is_shiny else icons)[number] = "data:image/png;base64," + base64.b64encode(content).decode("ascii")
    return icons, shiny

def index_from_exports(data_path, trainer_path, icons_dir):
    data = read_json(data_path)
    trainers = read_json(trainer_path)
    if not isinstance(data, dict):
        raise ValueError("Game data export must be a JSON object")
    if isinstance(trainers, dict):
        trainers = trainers.get("trainers")
    if not isinstance(trainers, list):
        raise ValueError("Trainer export must contain a trainers array")
    if not isinstance(data.get("species"), dict) or len(data["species"]) < 1:
        raise ValueError("Game data must contain species")
    payload = dict(data)
    payload["trainerTeams"] = trainers
    icons, shiny = collect_icons(icons_dir)
    return {
        "format": "briskdex-rom-v1",
        "indexVersion": 2,
        "data": payload,
        "assets": {"icons": icons, "shinyIcons": shiny},
    }

def pack(index):
    encoded = json.dumps(index, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    compressed = zlib.compress(encoded, level=9)
    if len(compressed) > MAX_PACK:
        raise ValueError("Compressed index exceeds 24 MiB")
    return compressed + struct.pack("<II", len(compressed), zlib.crc32(compressed)) + MAGIC

def install(rom, packed):
    if len(rom) < 0xC0 or rom[0xB2] != 0x96:
        raise ValueError("Not a recognized GBA ROM (bad fixed header byte)")
    if len(rom) > MAX_ROM:
        raise ValueError("GBA ROM exceeds 32 MiB")
    if len(packed) > MAX_PACK + 16:
        raise ValueError("Packed index is too large")
    # Trailing FF runs in a compiled ROM are unused padding; do not search
    # arbitrary middle-of-ROM gaps that might contain intentionally blank data.
    end = len(rom)
    offset = end
    while offset > 0 and rom[offset - 1] == 0xFF:
        offset -= 1
    free = end - offset
    if free >= len(packed):
        target = bytearray(rom)
        at = end - len(packed)
        target[at:end] = packed
    else:
        wanted = end + len(packed) - free
        new_length = 1 << (wanted - 1).bit_length()
        if new_length > MAX_ROM:
            raise ValueError(
                "No space for ROM index within the GBA 32 MiB limit. "
                "Free trailing ROM space in the game build or use a smaller index."
            )
        target = bytearray(rom)
        target.extend(b"\xFF" * (new_length - end))
        at = end - free
        target[at:at+len(packed)] = packed
    if bytes(target[:0xC0]) != rom[:0xC0]:
        raise AssertionError("GBA header was modified")
    if bytes(target[:offset]) != rom[:offset]:
        raise AssertionError("Non-padding ROM content was modified")
    return bytes(target), at

def verify(rom, expected):
    pos = rom.rfind(MAGIC)
    if pos < 8:
        raise ValueError("Index footer not found")
    length, checksum = struct.unpack_from("<II", rom, pos-8)
    compressed = rom[pos-8-length:pos-8]
    if len(compressed) != length or zlib.crc32(compressed) != checksum:
        raise ValueError("ROM index has failed CRC validation")
    result = json.loads(zlib.decompress(compressed))
    if result != expected:
        raise ValueError("ROM index round-trip does not match the source")
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gba", type=pathlib.Path, help="Input .gba ROM")
    parser.add_argument("--output", required=True, type=pathlib.Path, help="Output .gba (must be a different file)")
    parser.add_argument("--data", type=pathlib.Path, default=pathlib.Path("brisk-dex-data.json"))
    parser.add_argument("--trainers", type=pathlib.Path, default=pathlib.Path("brisk-dex-trainer-teams.json"))
    parser.add_argument("--icons", type=pathlib.Path, default=pathlib.Path("brisk-dex-icons"))
    parser.add_argument("--no-icons", action="store_true", help="Reduce size by omitting icons")
    args = parser.parse_args()
    if args.gba.resolve() == args.output.resolve():
        parser.error("The output must be separate; the original ROM will not be overwritten.")
    index = index_from_exports(args.data, args.trainers, None if args.no_icons else args.icons)
    rom = args.gba.read_bytes()
    full, at = install(rom, pack(index))
    verify(full, index)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(full)
    data = index["data"]
    print("Indexed ROM:", args.output)
    print("ROM bytes:", len(rom), "->", len(full), " | index offset:", hex(at))
    print("Species:", len(data["species"]), "| trainers:", len(data["trainerTeams"]),
          "| routes:", len(data.get("routeEncounters", [])),
          "| icons:", len(index["assets"]["icons"]),
          "| shiny icons:", len(index["assets"]["shinyIcons"]))
    print("Original ROM unchanged. Use indexed .gba in Brisk Dex ROM importer.")

if __name__ == "__main__":
    main()
