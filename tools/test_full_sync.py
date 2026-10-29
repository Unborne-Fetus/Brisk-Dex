"""Test the completed Brisk Emerald export after the extractor runs."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODES = ("Easy", "Normal", "Hard", "Kaizo")
# Exact assignments from Brisk Emerald's Pokémon species tables.
SIGNATURE_OWNERS = {
    "LEDIAN": "SPEED_BOXER",
    "DELCATTY": "NINE_LIVES",
    "KRICKETUNE": "GRAND_MAESTRO",
    "LUVDISC": "HEARTBREAKER",
    "SPIDOPS": "WEB_EXCRETANT",
    "DELIBIRD": "FLASH_FREEZE",
    "SUNKERN": "SOLAR_FLEET",
    "SUNFLORA": "SOLAR_FLEET",
    "CARNIVINE": "JAW_SNAP",
    "WATCHOG": "DURAN",
    "WUGTRIO": "CLEARWATER",
    "FURRET": "BUILD_ME_UP",
    "ARIADOS": "OVERDOSE",
    "MAGCARGO": "BURNING_CRUST",
    "LUMINEON": "OGOOUE_BASIN",
    "MARACTUS": "NOPALES",
    "SWALOT": "TORSION",
    "HEATMOR": "FLAME_TONGUE",
    "SEAKING": "CRASHER_WAKE",
    "THIEVUL": "MASTER_THIEF",
    "BEHEEYEM": "PSYCHIC_GRAVITY",
    "UNFEZANT": "RAGE_WINGS",
    "KECLEON": "CHROMATOPHORES",
}


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

    def test_source_placed_ultra_beasts_and_kaizo_rewards(self):
        species = {record["constant"]: int(sid)
                   for sid, record in self.data["species"].items()}
        locations = self.data["routeEncounters"]
        for name in ("XURKITREE", "CELESTEELA", "NIHILEGO"):
            sid = species[name]
            with self.subTest(name=name):
                self.assertTrue(any(method.get("type") == "static"
                                    and any(slot["species"] == sid for slot in method["slots"])
                                    for area in locations for method in area["methods"]),
                                name + " must have its actual source-placed encounter")
        for name in ("GUZZLORD", "NECROZMA"):
            sid = species[name]
            with self.subTest(name=name):
                self.assertTrue(any("Orange" in area["name"]
                                    and method.get("type") == "gift"
                                    and any(slot["species"] == sid for slot in method["slots"])
                                    for area in locations for method in area["methods"]),
                                name + " is a Kaizo-only Orange City trainer reward")


    def test_all_signature_abilities_have_names_descriptions_and_owners(self):
        details = {ability["constant"].removeprefix("ABILITY_"): (int(aid), ability)
                   for aid, ability in self.data["abilityDetails"].items()}
        species = {pokemon["constant"]: pokemon
                   for pokemon in self.data["species"].values()}
        expected = set(SIGNATURE_OWNERS.values())
        signature_ids = set(self.data.get("signatureAbilityIds", []))
        self.assertEqual(len(expected), 22)
        self.assertEqual(signature_ids, {details[name][0] for name in expected})
        for species_name, ability_name in SIGNATURE_OWNERS.items():
            with self.subTest(species=species_name, ability=ability_name):
                aid, ability = details[ability_name]
                self.assertIn(aid, signature_ids)
                self.assertTrue(ability["name"])
                self.assertTrue(ability["description"])
                self.assertIn(ability["name"], species[species_name]["abilities"])

if __name__ == "__main__":
    unittest.main()
