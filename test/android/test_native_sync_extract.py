"""Guard Brisk trainer flag extraction when new story teams use new prefixes."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
from extract_data import extract_trainer_defeat_flags


class TrainerFlagExtractionTests(unittest.TestCase):
    def test_kanto_source_ids_include_xiphos_and_preserve_existing_offsets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            constants = root / "include" / "constants"
            constants.mkdir(parents=True)
            hoenn = [
                "#define BRISK_HOENN_TRAINERS_COUNT 865",
                "#define BRISK_KANTO_TRAINER_BASE BRISK_HOENN_TRAINERS_COUNT",
            ] + [f"#define TRAINER_TEST_{i} {i}" for i in range(865)]
            (constants / "opponents.h").write_text("\n".join(hoenn))
            aliases = {
                624: "TRAINER_XIPHOS_COMMANDER_FAIRY",
                625: "TRAINER_XIPHOS_COMMANDER_FIGHTING",
                626: "TRAINER_XIPHOS_COMMANDER_STEEL",
                627: "TRAINER_XIPHOS_COMMANDER_DRAGON",
                639: "TRAINER_XIPHOS_JESSIE",
            }
            kanto = [
                f"#define {aliases.get(i, 'TRAINER_BRISK_KANTO_FAKE_' + str(i))} "
                f"(BRISK_KANTO_TRAINER_BASE + {i})"
                for i in range(640)
            ]
            (constants / "brisk_kanto_trainers.h").write_text("\n".join(kanto))
            flags = extract_trainer_defeat_flags(str(root))
            self.assertEqual(flags["ids"]["TRAINER_TEST_864"], 864)
            self.assertEqual(flags["ids"]["TRAINER_BRISK_KANTO_FAKE_623"], 1488)
            for offset, name in aliases.items():
                self.assertEqual(flags["ids"][name], 865 + offset)
            self.assertEqual(len(set(flags["ids"].values())), len(flags["ids"]))


if __name__ == "__main__":
    unittest.main()
