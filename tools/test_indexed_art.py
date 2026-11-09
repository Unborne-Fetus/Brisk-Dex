#!/usr/bin/env python3
"""Verify that indexed ROM artwork, cries and source identity travel with the ROM."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location("rom_index_test", Path(__file__).with_name("embed_rom_index.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDr8AAAAASUVORK5CYII=")
def run():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / "brisk-dex-sprites").mkdir()
        (root / "brisk-dex-cries").mkdir()
        (root / "brisk-dex-icons").mkdir()
        (root / "brisk-dex-sprites/1200_front.png").write_bytes(PNG)
        (root / "brisk-dex-sprites/1200_front_shiny.png").write_bytes(PNG)
        (root / "brisk-dex-sprites/1200_back.png").write_bytes(PNG)
        (root / "brisk-dex-cries/1200.wav").write_bytes(b"RIFF\x04\x00\x00\x00WAVE")
        (root / "brisk-dex-icons/1200.png").write_bytes(PNG)
        data = {"species":{"1200":{
            "name":"Copperhawk",
            "frontSprite":"brisk-dex-sprites/1200_front.png",
            "frontShinySprite":"brisk-dex-sprites/1200_front_shiny.png",
            "backSprite":"brisk-dex-sprites/1200_back.png",
            "cry":"brisk-dex-cries/1200.wav",
            "backShinySprite":"../../other-rom-shiny.png",
        }}, "moves":{"1":"Pound"},"abilities":{"1":"Stench"},"items":{"1":"Poke Ball"},
            "itemDetails":{"1":{"name":"Poke Ball"}},"routeEncounters":[],
            "mapCatalog":[{"id":"MAP_CUSTOM","name":"Custom Island"}]}
        (root / "brisk-dex-data.json").write_text(json.dumps(data), encoding="utf-8")
        (root / "brisk-dex-trainer-teams.json").write_text(json.dumps({"trainers":[]}), encoding="utf-8")
        index = mod.index_from_exports(root / "brisk-dex-data.json", root / "brisk-dex-trainer-teams.json",
                                       root / "brisk-dex-icons", True)
        species = index["data"]["species"]["1200"]
        assert species["frontSprite"].startswith("data:image/png;base64,"), "Custom front sprite missing"
        assert species["frontShinySprite"].startswith("data:image/png;base64,"), "Shiny sprite missing"
        assert species["cry"].startswith("data:audio/wav;base64,"), "Cry missing"
        assert "backShinySprite" not in species, "Unsafe relative source path was preserved"
        assert index["meta"]["artCount"] == 4
        without_art = mod.index_from_exports(root / "brisk-dex-data.json", root / "brisk-dex-trainer-teams.json",
                                             root / "brisk-dex-icons", False)
        assert "frontSprite" not in without_art["data"]["species"]["1200"], "Unbundled local asset leaked into ROM"
        rom = bytearray(b"\xFF" * 8192)
        rom[0xB2] = 0x96
        rom[0xA0:0xA7] = b"TESTROM"
        original = bytes(rom)
        live = len(original.rstrip(b"\xFF"))
        index["meta"]["sourceFingerprint"] = {
            "algorithm":"sha256","liveRomLength":live,
            "sha256":hashlib.sha256(original[:live]).hexdigest()
        }
        packed=mod.pack(index)
        built,at=mod.install(original,packed)
        recovered=mod.verify(built,index)
        assert recovered["data"]["species"]["1200"]["cry"]==species["cry"]
        assert recovered["meta"]["sourceFingerprint"]["sha256"]==hashlib.sha256(original[:live]).hexdigest()
        assert built[:live]==original[:live] and len(built)<=32*1024*1024
    print("ROM index art/cry portability, source fingerprints and index round-trip passed")

if __name__=="__main__":
    run()
