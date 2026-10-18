"""Regression checks for the bundled Brisk reference export. Run from repo root."""
import base64
import gzip
import io
import importlib.util
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('extract_data', ROOT / 'tools/extract_data.py')
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)

class ExtractedDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'brisk-dex-data.json').read_text())
        cls.species = cls.data['species']
        cls.graphics = json.loads((ROOT / 'brisk-dex-asset-patches/manifest.json').read_text())
        cls.packs = {}
        cls.by_constant = {mon['constant']: mon for mon in cls.species.values()}

    def asset(self, path):
        if path in self.graphics:
            pack = self.graphics[path]
            if pack not in self.packs:
                compressed = json.loads((ROOT / 'brisk-dex-asset-patches' / pack).read_text())
                self.packs[pack] = json.loads(gzip.decompress(base64.b64decode(compressed)))
            return base64.b64decode(self.packs[pack][path].split(',', 1)[1])
        return (ROOT / path).read_bytes()

    def test_renamed_constant_alias_does_not_shift_following_species(self):
        text = 'enum Species { SPECIES_DRAGONITE_MEGA_Y = 1652, SPECIES_NEXT };\n#define SPECIES_DRAGONITE_MEGA_CDRX SPECIES_DRAGONITE_MEGA_Y\n'
        self.assertEqual(extract.parse_constants(text, 'SPECIES_'), {
            'DRAGONITE_MEGA_Y': 1652, 'NEXT': 1653, 'DRAGONITE_MEGA_CDRX': 1652})
        self.assertEqual(self.species['1652']['formLabel'], 'Mega Y')
        self.assertIn('DRAGONITE_MEGA', self.by_constant)

    def test_rhydon_split_and_snorlax_balance(self):
        paths = self.species['112']['evolutions']
        self.assertIn({'target': 1642, 'method': 'EVO_LEVEL', 'parameter': '60'}, paths)
        self.assertIn({'target': 464, 'method': 'EVO_ITEM', 'parameter': 'ITEM_PROTECTOR'}, paths)
        self.assertFalse(self.species['464'].get('evolutions'))
        self.assertEqual(self.by_constant['SNORLAX_MEGA']['baseStats'][2], 75)
        self.assertEqual(self.by_constant['SNORLAX_MEGA']['baseStats'][5], 120)

    def test_added_species_have_art_shinies_and_moves(self):
        for sid, mon in self.species.items():
            if int(sid) < 1549 or mon['constant'] == 'EGG':
                continue
            with self.subTest(species=mon['constant']):
                self.assertTrue(mon['learnableMoves'])
                for field in ('frontSprite', 'backSprite', 'frontShinySprite', 'backShinySprite'):
                    self.assertTrue(self.asset(mon[field]))
        for name in ('RHYFORTRESS', 'DRAGONITE_MEGA_Y', 'SLUGAQUA', 'NOIVERN_MEGA'):
            with Image.open(io.BytesIO(self.asset(self.by_constant[name]['frontSprite']))) as image:
                self.assertEqual(image.size, (80, 80))

    def test_icon_manifest_includes_new_forms_on_all_platforms(self):
        manifest = json.loads((ROOT / 'brisk-dex-icon-manifest.json').read_text())
        for key in ('1642', '1652', '1683', '1694'):
            self.assertTrue(self.asset(manifest['icons'][key]))
            self.assertTrue(self.asset(manifest['shinyIcons'][key]))

    def test_guide_includes_current_adventure_and_contest_rules(self):
        changes = ' '.join(change for category in self.data['changes'] for change in category['changes'])
        for rule in ('Birch', '2v1', 'twelve', 'four bonus hearts', 'Rhyfortress', 'Dragoninite Y'):
            self.assertIn(rule, changes)

if __name__ == '__main__':
    unittest.main()
