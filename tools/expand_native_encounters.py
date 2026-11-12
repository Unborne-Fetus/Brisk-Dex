#!/usr/bin/env python3
"""Expand Brisk Dex's *native-only* wild encounter slots without changing the GBA ROM.

A larger table should not change the probability of existing encounters:
Brisk's land and water selectors ignore SPECIES_NONE entries, so pad with those
instead of duplicating existing species. Future native Fakémon can fill them.
"""
import argparse
import json
from pathlib import Path

# Per map and time-of-day. These are table capacity, not encounter probabilities.
NATIVE_ENCOUNTER_SLOTS = {"land_mons": 64, "water_mons": 32}
EMPTY_MON = {"min_level": 1, "max_level": 1, "species": "SPECIES_NONE"}


def expand_encounter_data(data: dict) -> dict:
    for group in data.get("wild_encounter_groups", []):
        # Battle Pike/Pyramid have distinct tables and generation requirements.
        if not group.get("for_maps"):
            continue
        fields = {field["type"]: field for field in group["fields"]}
        for encounter_type, target in NATIVE_ENCOUNTER_SLOTS.items():
            field = fields.get(encounter_type)
            if field is None:
                continue
            original_count = len(field["encounter_rates"])
            if original_count > target:
                raise ValueError(f"{encounter_type}: existing {original_count} slots exceed native limit {target}")
            for encounter in group.get("encounters", []):
                info = encounter.get(encounter_type)
                if info is None:
                    continue
                mons = info["mons"]
                if len(mons) not in (original_count, target):
                    raise ValueError(
                        f"{encounter.get('map', encounter.get('base_label'))}: "
                        f"{encounter_type} has {len(mons)} entries, expected {original_count} or {target}"
                    )
                if len(mons) < target:
                    mons.extend(dict(EMPTY_MON) for _ in range(target - len(mons)))
            if original_count < target:
                field["encounter_rates"].extend([0] * (target - original_count))
    return data


def expand_file(root: Path) -> None:
    path = root / "src/data/wild_encounters.json"
    if not path.is_file():
        raise FileNotFoundError(path)
    before = path.read_text(encoding="utf-8")
    data = json.loads(before)
    expand_encounter_data(data)
    after = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if before != after:
        path.write_text(after, encoding="utf-8")
    print("Native wild encounter capacity: 64 land / 32 water slots per map and time of day")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("checkout", type=Path, help="Imported native-only game source tree")
    expand_file(parser.parse_args().checkout.resolve())
