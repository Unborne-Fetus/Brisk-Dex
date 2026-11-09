#!/usr/bin/env python3
"""Regression checks for custom-map and multi-region ROM index extraction."""
import importlib.util
import json
import pathlib
import tempfile

source = pathlib.Path(__file__).with_name("extract_data.py")
spec = importlib.util.spec_from_file_location("brisk_source_extractor_test", source)
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


def run():
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        map_dir = root / "data/maps"
        kanto = map_dir / "Route223"
        write_json(kanto / "map.json", {
            "id": "MAP_ROUTE223",
            "name": "Route 223",
            "region": "REGION_KANTO",
            "map_type": "MAP_TYPE_ROUTE",
            "region_map_section": "MAPSEC_ROUTE223",
            "connections": [],
            "warp_events": []
        })
        (kanto / "scripts.inc").write_text("setwildbattle SPECIES_COPPERHAWK, 44, ITEM_NONE\n", encoding="utf-8")

        custom = map_dir / "CustomIsland"
        write_json(custom / "map.json", {
            "id": "MAP_CUSTOM_ISLAND",
            "name": "Custom Island",
            "region": "REGION_ORANGE_ISLANDS",
            "map_type": "MAP_TYPE_ROUTE",
            "region_map_section": "MAPSEC_CUSTOM_ISLAND",
            "connections": [{"map": "MAP_ROUTE223", "direction": "north"}],
            "warp_events": []
        })
        (custom / "scripts.inc").write_text("givemon SPECIES_COPPERHAWK, 12, ITEM_NONE\n", encoding="utf-8")

        out_file = root / "src/data/wild_encounters.json"
        write_json(out_file, {
            "wild_encounter_groups": [{
                "fields": [
                    {"type": "land_mons", "encounter_rates": [70, 30]},
                    {"type": "hidden_mons", "encounter_rates": [100]}
                ],
                "encounters": [{
                    "map": "MAP_ROUTE223",
                    "base_label": "FIRERED_ROUTE223",
                    "land_mons": {
                        "encounter_rate": 20,
                        "mons": [
                            {"species": "SPECIES_COPPERHAWK", "min_level": 15, "max_level": 19},
                            {"species": "SPECIES_MISTWING", "min_level": 20, "max_level": 22}
                        ]
                    },
                    "hidden_mons": {
                        "encounter_rate": 5,
                        "mons": [{"species": "SPECIES_MISTWING", "min_level": 8, "max_level": 8}]
                    }
                }]
            }]
        })
        species = {"COPPERHAWK": 1200, "MISTWING": 1201}
        routes = extractor.extract_route_encounters(str(root), species)
        catalog = extractor.extract_map_catalog(str(root))
        assert any(x["id"] == "MAP_ROUTE223" for x in catalog), "Kanto map absent from catalog"
        assert any(x["id"] == "MAP_CUSTOM_ISLAND" for x in catalog), "Custom new-region map absent"
        assert any(x["id"] == "MAP_ROUTE223" and any(m["type"] == "land_mons" for m in x["methods"]) for x in routes), "Kanto wild encounters omitted"
        assert any(x["id"] == "MAP_CUSTOM_ISLAND" and any(m["type"] == "gift" for m in x["methods"]) for x in routes), "Custom gift encounters omitted"
        route223 = next(x for x in routes if x["id"] == "MAP_ROUTE223")
        assert any(m["type"] == "hidden_mons" for m in route223["methods"]), "Custom hidden encounters omitted"
        grass = next(m for m in route223["methods"] if m["type"] == "land_mons")
        assert [slot["chance"] for slot in grass["slots"]] == [70.0, 30.0], "Generic encounter rates should not inherit Brisk-only uniform odds"
        # Re-run without a JSON wild table: scripts and map definitions must
        # continue to be recognized rather than losing all custom places.
        trainer_dir = root / "src/data"
        trainer_dir.mkdir(parents=True, exist_ok=True)
        (trainer_dir / "trainer_parties.h").write_text("""
static const struct TrainerMonItemCustomMoves sParty_Custom[] = {
    { .iv = 31, .lvl = 44, .species = SPECIES_COPPERHAWK,
      .heldItem = ITEM_METEOR_LENS, .moves = { MOVE_POUND, MOVE_ROCK_SLIDE } },
};
""", encoding="utf-8")
        (trainer_dir / "trainers.h").write_text("""
const struct Trainer gTrainers[] = {
    [TRAINER_CUSTOM_LEADER] = {
        .trainerName = _("ASTER"),
        .trainerClass = TRAINER_CLASS_LEADER,
        .partySize = ARRAY_COUNT(sParty_Custom),
        .party = {.ItemCustomMoves = sParty_Custom},
    },
};
""", encoding="utf-8")
        trainers = extractor.extract_trainer_teams(str(root))
        leader = next(t for t in trainers if t["constant"] == "TRAINER_CUSTOM_LEADER")
        assert leader["name"] == "ASTER" and leader["class"] == "Leader", "C trainer metadata not recovered"
        assert leader["party"][0]["species"] == "Copperhawk", "Custom trainer Pokémon missing"
        assert leader["party"][0]["fields"]["Level"] == "44", "Custom trainer level not recovered"
        assert leader["party"][0]["item"] == "Meteor Lens", "Held item not recovered"
        assert "Rock Slide" in leader["party"][0]["moves"], "Custom trainer move not recovered"
        out_file.unlink()
        scripted = extractor.extract_route_encounters(str(root), species)
        assert any(x["id"] == "MAP_CUSTOM_ISLAND" for x in scripted), "Script-only map not recovered"
        assert any(x["id"] == "MAP_ROUTE223" for x in scripted), "Static Pokémon on Kanto route not recovered"

    print("Source custom-route, Kanto and gift encounter tests passed")


if __name__ == "__main__":
    run()
