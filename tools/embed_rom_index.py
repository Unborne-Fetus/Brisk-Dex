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
import hashlib
import pathlib
import struct
import zlib

MAGIC = b"BDXROMZ!"
MAX_ROM = 32 * 1024 * 1024
MAX_PACK = 12 * 1024 * 1024

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


ART_FIELDS = ("frontSprite", "backSprite", "frontShinySprite", "backShinySprite",
              "frontAnimation", "backAnimation", "frontShinyAnimation", "backShinyAnimation", "cry")
ART_MIME = {".png": "image/png", ".gif": "image/gif",
            ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
            ".aif": "audio/aiff", ".aiff": "audio/aiff"}

def portable_art(data, source_dir):
    """Embed only exported, local, bounded source artwork; reject path traversal."""
    asset_count = 0
    root = source_dir.resolve()
    for species in data["species"].values():
        if not isinstance(species, dict):
            continue
        for field in ART_FIELDS:
            original = species.get(field)
            if not isinstance(original, str):
                continue
            if original.startswith("data:"):
                continue
            safe = (original.startswith(("brisk-dex-sprites/", "brisk-dex-cries/"))
                    and ".." not in pathlib.PurePosixPath(original).parts)
            file = (root / original).resolve() if safe else None
            if not file or not file.is_relative_to(root) or file.suffix.lower() not in ART_MIME or not file.is_file():
                species.pop(field, None)
                continue
            if file.stat().st_size > 1024 * 1024:
                raise ValueError("Artwork exceeds 1 MiB per-file limit: " + original)
            species[field] = ("data:" + ART_MIME[file.suffix.lower()] + ";base64,"
                              + base64.b64encode(file.read_bytes()).decode("ascii"))
            asset_count += 1
    return asset_count

def index_from_exports(data_path, trainer_path, icons_dir, with_art=False, save_profile=None):
    data = read_json(data_path)
    trainers = read_json(trainer_path)
    if not isinstance(data, dict):
        raise ValueError("Game data export must be a JSON object")
    if isinstance(trainers, dict):
        trainers = trainers.get("trainers")
    if not isinstance(trainers, list):
        raise ValueError("Trainer export must contain a trainers array")
    for key in ("species", "moves", "abilities", "items", "itemDetails"):
        if not isinstance(data.get(key), dict) or not data[key]:
            raise ValueError("Missing " + key + " data; regenerate the source exports before indexing")
    if not isinstance(data.get("mapCatalog"), list) or not data["mapCatalog"]:
        raise ValueError("Missing or empty mapCatalog: source-defined custom routes and maps must be indexed")
    if not isinstance(data.get("routeEncounters"), list):
        raise ValueError("Missing routeEncounters: regenerate the source wild encounter export")
    payload = dict(data)
    payload["trainerTeams"] = trainers
    art_count = portable_art(payload, data_path.parent) if with_art else 0
    # A clean index must not reference another computer's asset paths.
    if not with_art:
        for species in payload["species"].values():
            if isinstance(species, dict):
                for field in ART_FIELDS:
                    if isinstance(species.get(field), str) and not species[field].startswith("data:"):
                        species.pop(field, None)
    icons, shiny = collect_icons(icons_dir)
    index = {
        "format": "briskdex-rom-v1",
        "meta": {"artCount": art_count},
        "indexVersion": 2,
        "data": payload,
        "assets": {"icons": icons, "shinyIcons": shiny},
    }
    if save_profile:
        config = read_json(save_profile)
        profile = config.get("profile", config) if isinstance(config, dict) else None
        if not isinstance(profile, dict) or not profile.get("id") or not profile.get("name"):
            raise ValueError("Source save profile requires id and name")
        if profile.get("writePolicy") == "full" and not profile.get("fingerprints"):
            raise ValueError("Writable indexed profiles require strong save fingerprints")
        index["compatibility"] = {"profile": profile}
    return index

def pack(index):
    encoded = json.dumps(index, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > 48 * 1024 * 1024:
        raise ValueError("Reference index exceeds 48 MiB uncompressed")
    compressed = zlib.compress(encoded, level=9)
    if len(compressed) > MAX_PACK:
        raise ValueError("Compressed index exceeds 12 MiB")
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
    parser.add_argument("--with-art", action="store_true", help="Include source-exported front/back/shiny sprites, animations, and cries")
    parser.add_argument("--save-profile", type=pathlib.Path, help="Source-authored Emerald save profile JSON (never inferred from ROM names)")
    args = parser.parse_args()
    if args.gba.resolve() == args.output.resolve():
        parser.error("The output must be separate; the original ROM will not be overwritten.")
    index = index_from_exports(args.data, args.trainers, None if args.no_icons else args.icons, args.with_art, args.save_profile)
    rom = args.gba.read_bytes()
    live = len(rom)
    while live > 0xC0 and rom[live - 1] == 0xFF:
        live -= 1
    index['meta']['sourceFingerprint'] = {
        'algorithm': 'sha256', 'liveRomLength': live,
        'sha256': hashlib.sha256(rom[:live]).hexdigest(),
    }
    full, at = install(rom, pack(index))
    verify(full, index)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(full)
    data = index["data"]
    print("Indexed ROM:", args.output)
    print("ROM bytes:", len(rom), "->", len(full), " | index offset:", hex(at))
    print("Species:", len(data["species"]), "| trainers:", len(data["trainerTeams"]),
          "| routes:", len(data.get("routeEncounters", [])),
          "| maps:", len(data.get("mapCatalog", [])),
          "| items:", len(data.get("items", {})),
          "| icons:", len(index["assets"]["icons"]),
          "| shiny icons:", len(index["assets"]["shinyIcons"]),
          "| embedded art/cry files:", index["meta"]["artCount"])
    print("Original ROM unchanged. Use indexed .gba in Brisk Dex ROM importer.")

if __name__ == "__main__":
    main()
