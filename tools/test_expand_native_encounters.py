#!/usr/bin/env python3
"""Native encounter table capacity regression tests (no game assets required)."""
import copy
import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).with_name("expand_native_encounters.py")
spec = importlib.util.spec_from_file_location("expand_native_encounters", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    return {"wild_encounter_groups": [
        {"label": "gWildMonHeaders", "for_maps": True,
         "fields": [{"type": "land_mons", "encounter_rates": [50, 50]},
                    {"type": "water_mons", "encounter_rates": [100]}],
         "encounters": [
             {"map": "MAP_ROUTE101", "land_mons": {"encounter_rate": 30, "mons": [
                 {"min_level": 2, "max_level": 3, "species": "SPECIES_POOCHYENA"},
                 {"min_level": 3, "max_level": 3, "species": "SPECIES_WURMPLE"}]}},
             {"map": "MAP_ROUTE102", "water_mons": {"encounter_rate": 20, "mons": [
                 {"min_level": 5, "max_level": 7, "species": "SPECIES_MAGIKARP"}]}},
         ]},
        {"label": "gBattlePikeWildMonHeaders", "for_maps": False, "fields": [],
         "encounters": [{"base_label": "Pike", "land_mons": {"mons": [
             {"species": "SPECIES_SEVIPER", "min_level": 5, "max_level": 5}]}}]}
    ]}


class EncounterCapacityTests(unittest.TestCase):
    def test_preserves_encounters_and_expands_slots(self):
        data = fixture()
        original_pike = copy.deepcopy(data["wild_encounter_groups"][1])
        module.expand_encounter_data(data)
        main, pike = data["wild_encounter_groups"]
        self.assertEqual(len(main["fields"][0]["encounter_rates"]), 64)
        self.assertEqual(len(main["fields"][1]["encounter_rates"]), 32)
        self.assertEqual(len(main["encounters"][0]["land_mons"]["mons"]), 64)
        self.assertEqual(len(main["encounters"][1]["water_mons"]["mons"]), 32)
        self.assertEqual(main["encounters"][0]["land_mons"]["mons"][0]["species"], "SPECIES_POOCHYENA")
        self.assertEqual(main["encounters"][0]["land_mons"]["mons"][-1]["species"], "SPECIES_NONE")
        self.assertEqual(main["fields"][0]["encounter_rates"][:2], [50, 50])
        self.assertTrue(all(r == 0 for r in main["fields"][0]["encounter_rates"][2:]))
        self.assertEqual(pike, original_pike)

    def test_idempotent(self):
        once = module.expand_encounter_data(fixture())
        twice = module.expand_encounter_data(copy.deepcopy(once))
        self.assertEqual(once, twice)

    def test_rejects_mismatched_source(self):
        data = fixture()
        data["wild_encounter_groups"][0]["encounters"][0]["land_mons"]["mons"].pop()
        with self.assertRaisesRegex(ValueError, "expected"):
            module.expand_encounter_data(data)


if __name__ == "__main__":
    unittest.main()
