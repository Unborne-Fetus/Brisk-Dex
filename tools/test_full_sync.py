"""Test the completed Brisk Emerald export after the extractor runs."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODES = ("Easy", "Normal", "Hard", "Kaizo")

class SyncedContentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / "brisk-dex-data.json").read_text(encoding="utf-8"))
        teams = json.loads((ROOT / "brisk-dex-trainer-teams.json").read_text(encoding="utf-8"))
        cls.trainers = {t["constant"]: t for t in teams["trainers"]}

    def test_hoenn_gyms_have_four_playable_parties(self):
        for name in ("ROXANNE_1", "BRAWLY_1", "WATTSON_1", "FLANNERY_1",
                     "NORMAN_1", "WINONA_1", "TATE_AND_LIZA_1", "JUAN_1"):
            t = self.trainers["TRAINER_" + name]
            self.assertEqual(set(t["modeTeams"]), set(MODES))
            self.assertEqual(t["party"], t["modeTeams"]["Normal"])
            self.assertTrue(all(t["modeTeams"][m] for m in MODES))

    def test_all_kanto_gym_leader_aces(self):
        for name in ("BROCK", "MISTY", "LT_SURGE", "ERIKA",
                     "KOGA", "SABRINA", "BLAINE", "GIOVANNI"):
            t = self.trainers["TRAINER_BRISK_KANTO_LEADER_" + name]
            self.assertEqual(t["region"], "Kanto")
            self.assertTrue(t["locations"])
            for mode, level in zip(MODES, (92, 96, 99, 100)):
                team = t["modeTeams"][mode]
                self.assertEqual(len(team), 6)
                self.assertTrue(all(int(mon["fields"]["Level"]) == level for mon in team))

    def test_postgame_wild_encounters(self):
        areas = self.data["routeEncounters"]
        self.assertTrue(any("Frlg" in area.get("id", "") or
                            area.get("gameRegion") == "REGION_KANTO"
                            for area in areas))

if __name__ == "__main__":
    unittest.main()
