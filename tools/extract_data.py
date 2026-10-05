#!/usr/bin/env python3
"""
Brisk Dex data extractor for pokeemerald-expansion based projects
(built for Pokemon Brisk Emerald, but should work on any expansion fork
 that hasn't renamed the standard constants/data files).

Run this against your actual repo checkout -- it never talks to the network,
it just reads your source files and writes out:

  brisk-dex-data.json   -- species (name/types/abilities), moves, abilities, items
  brisk-dex-icons/      -- one <species_id>.png per species, copied from your
                           graphics/pokemon/<name>/icon.png source art

Usage:
    python3 extract_data.py /path/to/your/pokeemerald-expansion/checkout

Then in Brisk Dex: "Load species/move data" -> brisk-dex-data.json
                    "Load icon folder"       -> the brisk-dex-icons folder
"""
import json
import os
import re
import shutil
import struct
import sys
import zlib
try:
    from PIL import Image
except ImportError:
    Image = None

TYPE_NAMES = {
    "NONE": None, "NORMAL": "Normal", "FIGHTING": "Fighting", "FLYING": "Flying",
    "POISON": "Poison", "GROUND": "Ground", "ROCK": "Rock", "BUG": "Bug",
    "GHOST": "Ghost", "STEEL": "Steel", "MYSTERY": None, "FIRE": "Fire",
    "WATER": "Water", "GRASS": "Grass", "ELECTRIC": "Electric", "PSYCHIC": "Psychic",
    "ICE": "Ice", "DRAGON": "Dragon", "DARK": "Dark", "FAIRY": "Fairy",
}

def read_jasc_palette(palette_file):
    if not os.path.isfile(palette_file):
        return None
    lines = read(palette_file).splitlines()
    if len(lines) < 3 or lines[0] != 'JASC-PAL':
        return None
    count = int(lines[2])
    colors = [tuple(map(int, line.split())) for line in lines[3:3 + count]]
    if not colors or len(colors) != count or any(len(color) != 3 for color in colors):
        return None
    return colors

def png_palette(source_png):
    try:
        png = open(source_png, 'rb').read()
        if not png.startswith(b'\x89PNG\r\n\x1a\n'):
            return None
        pos = 8
        while pos < len(png):
            size = struct.unpack('>I', png[pos:pos + 4])[0]
            kind = png[pos + 4:pos + 8]
            data = png[pos + 8:pos + 8 + size]
            if kind == b'PLTE' and size % 3 == 0:
                return [tuple(data[i:i + 3]) for i in range(0, size, 3)]
            pos += size + 12
    except (OSError, ValueError, struct.error):
        pass
    return None

def palette_variant_png(source_png, normal_palette_file, shiny_palette_file, want_shiny, target_png):
    """Render a source sprite with the requested Brisk normal/shiny palette.

    Some Expansion back PNGs are stored with their shiny palette embedded while
    fronts are stored normal. Detect which palette the source most closely uses
    before remapping so normal and shiny exports are always distinct/correct.
    """
    if not os.path.isfile(source_png):
        return False
    try:
        normal_colors = read_jasc_palette(normal_palette_file)
        shiny_colors = read_jasc_palette(shiny_palette_file)
        source_colors = png_palette(source_png)
        if not normal_colors or not shiny_colors or not source_colors:
            return False

        def palette_distance(reference):
            limit = min(len(source_colors), len(reference))
            if not limit:
                return float('inf')
            return sum(
                sum((source_colors[i][channel] - reference[i][channel]) ** 2 for channel in range(3))
                for i in range(limit)
            ) / limit

        reference = shiny_colors if palette_distance(shiny_colors) < palette_distance(normal_colors) else normal_colors
        target = shiny_colors if want_shiny else normal_colors

        png = open(source_png, 'rb').read()
        chunks = []
        pos = 8
        replaced = False
        while pos < len(png):
            size = struct.unpack('>I', png[pos:pos + 4])[0]
            kind = png[pos + 4:pos + 8]
            data = png[pos + 8:pos + 8 + size]
            if kind == b'PLTE':
                embedded = [tuple(data[i:i + 3]) for i in range(0, size, 3)]
                remapped = []
                for source_color in embedded:
                    nearest = min(range(len(reference)), key=lambda i: sum(
                        (source_color[channel] - reference[i][channel]) ** 2
                        for channel in range(3)))
                    remapped.append(tuple(max(0, min(255,
                        target[nearest][channel] + source_color[channel] - reference[nearest][channel]))
                        for channel in range(3)))
                data = bytes(channel for color in remapped for channel in color)
                replaced = True
            crc = zlib.crc32(kind + data) & 0xFFFFFFFF
            chunks.append(struct.pack('>I', len(data)) + kind + data + struct.pack('>I', crc))
            pos += size + 12
        if not replaced:
            return False
        with open(target_png, 'wb') as out:
            out.write(png[:8] + b''.join(chunks))
        return True
    except (OSError, ValueError, IndexError, struct.error):
        return False

def normalize_sprite_png(source_png, target_png, first_frame=False, transparent_bg=False):
    """Copy a PNG for the companion app, optionally taking frame 1 and clearing connected border backgrounds."""
    if not os.path.isfile(source_png):
        return False
    if Image is None:
        shutil.copyfile(source_png, target_png)
        return True
    try:
        with Image.open(source_png) as source:
            image = source.convert("RGBA")
            if first_frame and image.height > image.width and image.height >= image.width * 2:
                image = image.crop((0, 0, image.width, image.width))
            elif first_frame and image.width > image.height and image.width >= image.height * 2:
                image = image.crop((0, 0, image.height, image.height))

            if transparent_bg and image.width and image.height:
                pixels = image.load()
                border = []
                for x in range(image.width):
                    border.append(pixels[x, 0])
                    border.append(pixels[x, image.height - 1])
                for y in range(image.height):
                    border.append(pixels[0, y])
                    border.append(pixels[image.width - 1, y])

                opaque_border = [px for px in border if px[3] > 16]
                if opaque_border:
                    # Item art is palette-based. The most common border color is
                    # the canvas color, even when one corner contains stray pixels.
                    counts = {}
                    for px in opaque_border:
                        rgb = px[:3]
                        counts[rgb] = counts.get(rgb, 0) + 1
                    bg = max(counts, key=counts.get)

                    def near_bg(px):
                        if px[3] <= 16:
                            return True
                        r, g, b = px[:3]
                        return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) <= 30

                    # Only remove pixels connected to the outer edge. This avoids
                    # deleting same-colored highlights/details inside the icon.
                    stack = []
                    seen = set()
                    for x in range(image.width):
                        stack.append((x, 0))
                        stack.append((x, image.height - 1))
                    for y in range(image.height):
                        stack.append((0, y))
                        stack.append((image.width - 1, y))

                    while stack:
                        x, y = stack.pop()
                        if (x, y) in seen or x < 0 or y < 0 or x >= image.width or y >= image.height:
                            continue
                        seen.add((x, y))
                        px = pixels[x, y]
                        if not near_bg(px):
                            continue
                        pixels[x, y] = (px[0], px[1], px[2], 0)
                        stack.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))

            image.save(target_png)
        return True
    except (OSError, ValueError):
        shutil.copyfile(source_png, target_png)
        return True


def extract_feature_catalog(repo):
    """Turn Expansion's FEATURES.md into categorized readable entries, then append Brisk-specific changes."""
    text = read(os.path.join(repo, "FEATURES.md")) or ""
    categories = []
    current = None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("## ") and line not in ("## Table of Contents", "## Configuration files"):
            current = {"category": re.sub(r'^##\s+', '', line).strip(), "changes": []}
            categories.append(current)
            continue
        if current and line.startswith("- "):
            cleaned = re.sub(r'\[(.*?)\]\([^)]*\)', r'\1', line[2:])
            cleaned = cleaned.replace("***", "").replace("**", "").replace("*", "")
            cleaned = re.sub(r'\s+', ' ', cleaned).strip()
            if cleaned and not cleaned.startswith("["):
                current["changes"].append(cleaned)

    brisk = [
        ("Pokémon & Encounters", "All generations through Gen IX are represented, with Brisk-specific encounter tables and expanded land/water slots."),
        ("Pokémon & Encounters", "Land encounters use 25 slots and water encounters use 11 slots; SPECIES_NONE slots are skipped so valid entries share the available chance."),
        ("Pokémon & Encounters", "Mirage Island is permanently available."),
        ("Pokémon & Encounters", "Special static encounters include Kubfu in Meteor Falls and Meloetta in Artisan Cave B1F."),
        ("Pokédex & Catching", "The National Pokédex is enabled from the start."),
        ("Pokédex & Catching", "Ball selection can display catch-rate information, and the last-used ball shortcut is enabled."),
        ("Pokédex & Catching", "Catch-swap HM restrictions are disabled."),
        ("Battle Mechanics", "Battle gimmick handling supports Mega Evolution, Ultra Burst, Z-Moves, Terastallization, Dynamax and Gigantamax with Brisk-specific priority handling."),
        ("Battle Mechanics", "The Tera Orb recharges when the party is healed."),
        ("Battle Mechanics", "Smart wild AI support is enabled for configured encounters."),
        ("Battle Mechanics", "Shiny odds are configured to Brisk's custom value."),
        ("Battle Mechanics", "Pokérus spread odds are increased from the standard behavior."),
        ("Progression & Quality of Life", "Fly can be used from the beginning instead of waiting for the Fortree badge."),
        ("Progression & Quality of Life", "EXP Share behavior was changed so shared experience does not reduce the calculated award."),
        ("Progression & Quality of Life", "Battle speed and overworld speed-up options are available."),
        ("Progression & Quality of Life", "The player can use Poke Rider-style travel support where configured."),
        ("Trainers & Challenges", "Route 135's Champion Archives contains high-level battles against champions and major trainers including Blue, Red, Wallace, Cynthia, Iris, Diantha, Leon, Nemona and Volo."),
        ("Trainers & Challenges", "A custom Unborne Champion battle uses an omniscient AI configuration and a custom reward."),
        ("Maps & Events", "Slateport includes a custom stone-selling clerk."),
        ("Maps & Events", "Rayquaza-related progression can award the Mystic Ticket."),
        ("Storage & Systems", "Brisk expands and modifies internal systems beyond vanilla Emerald, including save-backed Pokémon data and modern species/forms from pokeemerald-expansion.")
    ]
    brisk_map = {}
    for category, change in brisk:
        brisk_map.setdefault(category, []).append(change)
    out = [{"category": "Brisk-specific · " + category, "changes": changes} for category, changes in brisk_map.items()]
    out.extend({"category": "Expansion · " + row["category"], "changes": row["changes"]} for row in categories if row["changes"])
    return out

def read(path):
    if not os.path.isfile(path):
        return None
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()

def read_dir_concat(path):
    """Some expansion versions split a table across a folder of .h files."""
    if not os.path.isdir(path):
        return ""
    out = []
    for root, _, files in os.walk(path):
        for fn in sorted(files):
            if fn.endswith('.h') or fn.endswith('.inc'):
                out.append(read(os.path.join(root, fn)) or "")
    return "\n".join(out)

def find_source(repo, *candidates):
    """Try a list of relative paths (files or directories); return concatenated text."""
    combined = ""
    for rel in candidates:
        full = os.path.join(repo, rel)
        if os.path.isdir(full):
            combined += read_dir_concat(full)
        else:
            content = read(full)
            if content:
                combined += content
    return combined

def strip_comments(text):
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    text = re.sub(r'//[^\n]*', '', text)
    return text

def parse_defines(text, prefix):
    """#define SPECIES_BULBASAUR 1  ->  {'BULBASAUR': 1}"""
    out = {}
    pattern = re.compile(r'#define\s+' + re.escape(prefix) + r'([A-Za-z0-9_]+)\s+(\d+)\b')
    for m in pattern.finditer(text or ""):
        out[m.group(1)] = int(m.group(2))
    return out

def parse_enums(text, prefix):
    """
    enum { SPECIES_NONE, SPECIES_BULBASAUR, SPECIES_IVYSAUR = 50, ... };
    Sequentially numbers entries starting at 0 (or the prior explicit value + 1),
    restarting at each separate enum block (matching C semantics).
    """
    out = {}
    text = strip_comments(text or "")
    for enum_m in re.finditer(r'\benum\b[^{]*\{', text):
        start = enum_m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            if text[i] == '{': depth += 1
            elif text[i] == '}': depth -= 1
            i += 1
        block = text[start:i-1]
        counter = 0
        enum_values = {}
        for raw in block.split(','):
            token = raw.strip()
            if not token:
                continue
            m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(.+))?$', token)
            if not m:
                continue
            name, value_expr = m.group(1), m.group(2)
            if value_expr:
                ve = value_expr.strip()
                if re.match(r'^\d+$', ve):
                    counter = int(ve)
                elif re.match(r'^0[xX][0-9a-fA-F]+$', ve):
                    counter = int(ve, 16)
                elif ve in enum_values:
                    counter = enum_values[ve]
            if name.startswith(prefix):
                out[name[len(prefix):]] = counter
            enum_values[name] = counter
            counter += 1
    return out

def parse_constants(text, prefix):
    """Merge #define-style and enum-style constant declarations."""
    out = {}
    out.update(parse_enums(text, prefix))
    out.update(parse_defines(text, prefix))  # #define (if any) takes priority when both exist
    return out

def extract_blocks(text, prefix):
    """
    Find  [SPECIES_FOO] = { ... },   style table entries and return
    {'FOO': '<contents between the braces>'}. Handles nested braces.
    """
    out = {}
    marker = re.compile(r'\[\s*' + re.escape(prefix) + r'([A-Za-z0-9_]+)\s*\]\s*=\s*\{')
    for m in marker.finditer(text):
        name = m.group(1)
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            if text[i] == '{': depth += 1
            elif text[i] == '}': depth -= 1
            i += 1
        out[name] = text[start:i-1]
    # Some species entries use a macro as the entire initializer (e.g. Genesect).
    macros = extract_macro_definitions(text)
    macro_entry = re.compile(r'\[\s*' + re.escape(prefix)
                             + r'([A-Za-z0-9_]+)\s*\]\s*=\s*([A-Za-z_]\w*\([^;\n]*\)),')
    for match in macro_entry.finditer(text):
        out.setdefault(match.group(1), add_invoked_species_macros(match.group(2), macros))
    return out

def extract_macro_definitions(text):
    """Collect C macros, joining backslash-continued bodies for data lookup."""
    lines = (text or "").splitlines()
    macros = {}
    i = 0
    while i < len(lines):
        # In C, a function-like macro has '(' immediately after its name;
        # whitespace before '(' means an object-like macro whose body starts there.
        match = re.match(r'^\s*#\s*define\s+([A-Za-z_]\w*)(?:\([^)]*\))?\s*(.*)$', lines[i])
        if not match:
            i += 1
            continue
        name, body = match.groups()
        parts = [body]
        while parts[-1].rstrip().endswith('\\') and i + 1 < len(lines):
            parts[-1] = parts[-1].rstrip()[:-1]
            i += 1
            parts.append(lines[i])
        macros[name] = '\n'.join(parts)
        i += 1
    return macros

def add_invoked_species_macros(block, macros):
    """Expose shared fields defined by the form/species macros used in a block."""
    pending = re.findall(r'\b[A-Za-z_]\w*\b', block or "")
    visited = set()
    inherited = []
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        body = macros.get(name, "")
        if body:
            inherited.append(body)
            pending.extend(re.findall(r'\b[A-Za-z_]\w*\b', body))
    return (block or "") + '\n' + '\n'.join(inherited)

def extract_string_field(block, *field_names):
    for field in field_names:
        m = re.search(re.escape(field) + r'\s*=\s*(?:_|COMPOUND_STRING)\(\s*"((?:[^"\\]|\\.)*)"\s*\)', block)
        if m:
            return m.group(1).replace('\\"', '"')
    return None

def extract_numeric_field(block, field, default=None):
    """Read a numeric struct field, preferring the modern/true side of simple ternaries."""
    if not block:
        return default
    field_re = re.escape(field)
    direct = re.search(field_re + r'\s*=\s*(-?\d+)\b', block)
    if direct:
        return int(direct.group(1))
    ternary = re.search(field_re + r'\s*=\s*[^,?]+\?\s*(-?\d+)\s*:\s*(-?\d+)', block)
    if ternary:
        return int(ternary.group(1))
    return default

def extract_enum_field(block, field, prefix, default=None):
    if not block:
        return default
    match = re.search(re.escape(field) + r'\s*=\s*[^,\n]*?\b' + re.escape(prefix) + r'([A-Za-z0-9_]+)', block)
    return match.group(1) if match else default

def pretty_constant(value):
    return (value or "").replace("_", " ").title()

def extract_types(block):
    # accepts ".types = { TYPE_X, TYPE_Y }" or ".types = ANY_MACRO_NAME(TYPE_X, TYPE_Y)"
    block = re.sub(r'P_UPDATED_TYPES\s*>=\s*GEN_\d+\s*\?\s*TYPE_([A-Za-z0-9_]+)\s*:\s*TYPE_[A-Za-z0-9_]+', r'TYPE_\1', block or "")
    m = re.search(r'\.types\s*=\s*(?:[A-Za-z_]\w*\s*\(|\{)\s*TYPE_([A-Za-z0-9_]+)\s*(?:,\s*TYPE_([A-Za-z0-9_]+))?', block)
    types = []
    candidates = list(m.groups()) if m else []
    for g in candidates + re.findall(r'\bTYPE_([A-Za-z0-9_]+)', block or ""):
        if g and g in TYPE_NAMES and TYPE_NAMES[g] and TYPE_NAMES[g] not in types:
            types.append(TYPE_NAMES[g])
    return types

def extract_abilities(block):
    ids = []
    # form 1: ".abilities = { ABILITY_X, ... }"  or  ".abilities = ANY_MACRO(ABILITY_X, ...)"
    m = re.search(r'\.abilities\s*=\s*(?:[A-Za-z_]\w*\s*\(|\{)([^}\)]*)[\}\)]', block)
    if m:
        for part in m.group(1).split(','):
            am = re.match(r'\s*ABILITY_([A-Za-z0-9_]+)', part)
            if am:
                ids.append(None if am.group(1) == 'NONE' else am.group(1))
        if ids:
            return ids
    # form 2: ".abilities[0] = ABILITY_X, .abilities[1] = ABILITY_Y, .abilities[2] = ABILITY_Z"
    for m in re.finditer(r'\.abilities\s*\[\s*\d+\s*\]\s*=\s*ABILITY_([A-Za-z0-9_]+)', block):
        if m.group(1) != 'NONE':
            ids.append(m.group(1))
    if ids:
        return ids
    # form 3: separate named fields, e.g. ".ability1 = ABILITY_X, .ability2 = ABILITY_Y, .abilityHidden = ABILITY_Z"
    for field in ('ability1', 'ability2', 'abilityHidden', 'ability3'):
        m = re.search(r'\.' + field + r'\s*=\s*ABILITY_([A-Za-z0-9_]+)', block)
        if m and m.group(1) != 'NONE':
            ids.append(m.group(1))
    if not ids:
        ids = [name for name in re.findall(r'\bABILITY_([A-Za-z0-9_]+)', block or "") if name != 'NONE']
    return ids



def decode_c_strings(text):
    parts = re.findall(r'"((?:\\.|[^"\\])*)"', text or "")
    out = "".join(parts)
    return (out.replace("\\n", " ").replace("\\p", " ")
               .replace("\\\"", '"').replace("\\\\", "\\").strip())

def extract_compound_field(block, field):
    if not block:
        return None
    m = re.search(re.escape(field) + r'\s*=\s*(?:COMPOUND_STRING|_|ITEM_NAME)\s*\((.*?)\)\s*,', block, re.S)
    if m:
        return re.sub(r'\s+', ' ', decode_c_strings(m.group(1))).strip()
    return None

def build_pokedex_text_table(repo, species_text):
    text = find_source(repo, "src/data/pokemon/species_info/shared_dex_text.h",
                       "src/data/pokemon/pokedex_text.h")
    table = {}
    for m in re.finditer(r'const\s+u8\s+(g[A-Za-z0-9_]+PokedexText)\[\]\s*=\s*_\s*\((.*?)\)\s*;', text, re.S):
        table[m.group(1)] = re.sub(r'\s+', ' ', decode_c_strings(m.group(2))).strip()
    return table

def extract_reference_locations(repo):
    trainer_locations = {}
    item_locations = {}
    maps_dir = os.path.join(repo, "data/maps")
    if not os.path.isdir(maps_dir):
        return trainer_locations, item_locations

    def pretty(raw):
        raw = (raw or "").replace("_", " ")
        raw = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', raw)
        raw = re.sub(r'(?<=[A-Za-z])(?=\d)', ' ', raw)
        return re.sub(r'\s+', ' ', raw).strip()

    def add(bucket, key, location, method):
        if not key:
            return
        row = {"location": location, "method": method}
        rows = bucket.setdefault(key, [])
        if row not in rows:
            rows.append(row)

    for folder in sorted(os.listdir(maps_dir)):
        root = os.path.join(maps_dir, folder)
        if not os.path.isdir(root):
            continue
        info = {}
        map_json = read(os.path.join(root, "map.json"))
        if map_json:
            try:
                info = json.loads(map_json)
            except ValueError:
                info = {}
        location = pretty(info.get("name") or folder)

        for bg in info.get("bg_events", []) if isinstance(info, dict) else []:
            if bg.get("type") == "hidden_item":
                add(item_locations, bg.get("item"), location, "Hidden item")

        scripts = read(os.path.join(root, "scripts.inc")) or ""
        for constant in set(re.findall(r'\b(TRAINER_[A-Z0-9_]+)\b', scripts)):
            add(trainer_locations, constant, location, "Trainer battle")
        for m in re.finditer(r'\b(giveitem(?:_msg)?|additem)\b[^\n]*\b(ITEM_[A-Z0-9_]+)\b', scripts):
            add(item_locations, m.group(2), location, "Gift / reward")
        if re.search(r'\bpokemart\b', scripts):
            for item in set(re.findall(r'\.2byte\s+(ITEM_[A-Z0-9_]+)', scripts)):
                add(item_locations, item, location, "Shop")

    return trainer_locations, item_locations

def extract_trainer_teams(repo):
    """Parse Brisk Emerald's trainers.party into JSON-friendly trainer/team records."""
    path = os.path.join(repo, "src/data/trainers.party")
    if not os.path.isfile(path):
        return []

    text = open(path, encoding="utf-8").read()
    # Remove C comments; preserve line breaks so trainer blocks remain readable.
    text = re.sub(r'/\*[\s\S]*?\*/', lambda m: ''.join('\n' if c == '\n' else ' ' for c in m.group(0)), text)
    matches = list(re.finditer(r'^===\s*(TRAINER_[A-Z0-9_]+)\s*===\s*$', text, re.MULTILINE))
    trainers = []

    def parse_mon_header(line):
        item = None
        left = line.strip()
        if " @ " in left:
            left, item = left.rsplit(" @ ", 1)
            left, item = left.strip(), item.strip()
        gender = None
        gm = re.search(r'\s+\(([MF])\)\s*$', left)
        if gm:
            gender = gm.group(1)
            left = left[:gm.start()].strip()
        nickname = None
        species = left
        nm = re.match(r'^(.+?)\s+\(([^()]+)\)$', left)
        if nm:
            nickname, species = nm.group(1).strip(), nm.group(2).strip()
        return {"species": species, "nickname": nickname, "gender": gender, "item": item}

    for i, match in enumerate(matches):
        constant = match.group(1)
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        lines = text[match.end():end].splitlines()
        meta, party = {}, []
        p = 0
        while p < len(lines) and not lines[p].strip():
            p += 1
        while p < len(lines):
            line = lines[p].strip()
            if not line:
                p += 1
                break
            field = re.match(r'^([^:]+):\s*(.*)$', line)
            if not field:
                break
            meta[field.group(1).strip()] = field.group(2).strip()
            p += 1

        while p < len(lines):
            while p < len(lines) and not lines[p].strip():
                p += 1
            if p >= len(lines):
                break
            header = lines[p].strip()
            p += 1
            if not header:
                continue
            mon = parse_mon_header(header)
            mon["moves"] = []
            mon["fields"] = {}
            while p < len(lines) and lines[p].strip():
                line = lines[p].strip()
                p += 1
                if line.startswith("- "):
                    mon["moves"].append(line[2:].strip())
                    continue
                field = re.match(r'^([^:]+):\s*(.*)$', line)
                if field:
                    mon["fields"][field.group(1).strip()] = field.group(2).strip()
            party.append(mon)

        trainers.append({
            "constant": constant,
            "name": meta.get("Name", ""),
            "class": meta.get("Class", "Pkmn Trainer"),
            "pic": meta.get("Pic", ""),
            "gender": meta.get("Gender", ""),
            "music": meta.get("Music", ""),
            "items": meta.get("Items", ""),
            "battleType": meta.get("Battle Type", meta.get("Double Battle", "")),
            "ai": meta.get("AI", ""),
            "mugshot": meta.get("Mugshot", ""),
            "startingStatus": meta.get("Starting Status", ""),
            "multiParty": meta.get("Multi Party", ""),
            "party": party,
        })
    return trainers


def extract_route_encounters(repo, species_ids):
    encounters_path = os.path.join(repo, "src/data/wild_encounters.json")
    if not os.path.isfile(encounters_path):
        return []
    try:
        source = json.loads(read(encounters_path))
    except (ValueError, TypeError):
        return []

    map_info = {}
    maps_dir = os.path.join(repo, "data/maps")
    if os.path.isdir(maps_dir):
        for root, _, files in os.walk(maps_dir):
            if "map.json" not in files:
                continue
            try:
                info = json.loads(read(os.path.join(root, "map.json")))
            except (ValueError, TypeError):
                continue
            map_id = info.get("id")
            if map_id:
                raw_name = info.get("name") or map_id.removeprefix("MAP_").title()
                pretty_name = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', raw_name)
                pretty_name = re.sub(r'(?<=[A-Za-z])(?=\d)', ' ', pretty_name).replace('_', ' ')
                section = (info.get("region_map_section") or "").removeprefix("MAPSEC_")
                section = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', section.replace('_', ' ')).title()
                map_info[map_id] = {
                    "name": pretty_name,
                    "mapType": info.get("map_type", ""),
                    "gameRegion": info.get("region", ""),
                    "region": section
                }

    method_names = {
        "land_mons": "Walking",
        "water_mons": "Surfing",
        "rock_smash_mons": "Rock Smash",
        "fishing_mons": "Fishing"
    }
    rod_names = {"old_rod": "Old Rod", "good_rod": "Good Rod", "super_rod": "Super Rod"}
    out = []
    for group in source.get("wild_encounter_groups", []):
        field_info = {field.get("type"): field for field in group.get("fields", [])}
        for raw in group.get("encounters", []):
            map_id = raw.get("map")
            if not map_id:
                continue
            info = map_info.get(map_id, {})
            source_label = (raw.get("base_label") or "").upper()
            if info.get("gameRegion") == "REGION_KANTO" or any(tag in source_label for tag in ("FIRERED", "LEAFGREEN", "FRLG")):
                continue
            methods = []
            variant_match = re.search(r'ALTERINGCAVE(\d+)', source_label)
            for method_key, method_title in method_names.items():
                method_data = raw.get(method_key)
                if not method_data:
                    continue
                metadata = field_info.get(method_key, {})
                mons = method_data.get("mons", [])
                rates = metadata.get("encounter_rates", [])
                subsets = metadata.get("groups", {}) if method_key == "fishing_mons" else {}
                if subsets:
                    sections = [(rod_names.get(name, name.replace('_', ' ').title()), indices)
                                for name, indices in subsets.items()]
                else:
                    sections = [(method_title, list(range(len(mons))))]
                for section_name, indices in sections:
                    valid_indices = [i for i in indices if 0 <= i < len(mons)]
                    # Brisk Emerald chooses land/water slots uniformly and skips NONE.
                    uniform = method_key in ("land_mons", "water_mons")
                    if uniform:
                        valid_indices = [i for i in valid_indices
                                         if mons[i].get("species") != "SPECIES_NONE"]
                    weights = {i: 1 if uniform else (rates[i] if i < len(rates) else 0)
                               for i in valid_indices}
                    total_weight = sum(weights.values())
                    slots = []
                    for i in valid_indices:
                        mon = mons[i]
                        constant = (mon.get("species") or "").removeprefix("SPECIES_")
                        species_id = species_ids.get(constant)
                        if not species_id or str(species_id) == "0":
                            continue
                        weight = weights[i]
                        slots.append({
                            "species": species_id,
                            "minLevel": int(mon.get("min_level", 1)),
                            "maxLevel": int(mon.get("max_level", mon.get("min_level", 1))),
                            "slot": i + 1,
                            "chance": round((weight / total_weight) * 100, 2) if total_weight else 0
                        })
                    if slots:
                        methods.append({
                            "name": ("Pattern " + variant_match.group(1) + " · " + section_name) if variant_match else section_name,
                            "type": method_key,
                            "encounterRate": int(method_data.get("encounter_rate", 0)),
                            "slots": slots
                        })
            if methods:
                name = info.get("name") or re.sub(r'(?<=[A-Z])(?=[0-9])', ' ', map_id.removeprefix("MAP_").replace('_', ' ').title())
                out.append({
                    "id": map_id,
                    "name": name,
                    "mapType": info.get("mapType", ""),
                    "gameRegion": info.get("gameRegion", ""),
                    "region": info.get("region", ""),
                    "methods": methods
                })

    # Add stationary encounters and handed-out Pokémon from map scripts.
    # This includes visible/event Pokémon (seteventmon) and battle-triggered
    # encounters (setwildbattle), plus explicit NPC gifts (givemon).
    area_by_id = {area["id"]: area for area in out}
    static_seen = set()
    for root, _, files in os.walk(maps_dir):
        if "scripts.inc" not in files or "map.json" not in files:
            continue
        try:
            info = json.loads(read(os.path.join(root, "map.json")))
        except (ValueError, TypeError):
            continue
        map_id = info.get("id")
        if not map_id or info.get("region") == "REGION_KANTO":
            continue
        script = strip_comments(read(os.path.join(root, "scripts.inc")) or "")
        for match in re.finditer(r'\b(setwildbattle|seteventmon|givemon)\s+SPECIES_([A-Z0-9_]+)\s*,\s*(\d+)\b', script):
            command, constant, level_text = match.groups()
            species_id = species_ids.get(constant)
            if not species_id or str(species_id) == "0":
                continue
            kind = "gift" if command == "givemon" else "static"
            level = int(level_text)
            signature = (map_id, kind, species_id, level)
            if signature in static_seen:
                continue
            static_seen.add(signature)
            area = area_by_id.get(map_id)
            if area is None:
                raw_name = info.get("name") or map_id.removeprefix("MAP_").title()
                name = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', raw_name)
                name = re.sub(r'(?<=[A-Za-z])(?=\d)', ' ', name).replace('_', ' ')
                section = (info.get("region_map_section") or "").removeprefix("MAPSEC_")
                section = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', section.replace('_', ' ')).title()
                area = {
                    "id": map_id,
                    "name": name,
                    "mapType": info.get("map_type", ""),
                    "gameRegion": info.get("region", ""),
                    "region": section,
                    "methods": []
                }
                out.append(area)
                area_by_id[map_id] = area
            method_name = "Gift" if kind == "gift" else "Static"
            method = next((entry for entry in area["methods"] if entry["type"] == kind and entry["name"] == method_name), None)
            if method is None:
                method = {"name": method_name, "type": kind, "encounterRate": 0, "slots": []}
                area["methods"].append(method)
            method["slots"].append({"species": species_id, "minLevel": level, "maxLevel": level})

    # Keep the encounter browser in the order players reach these places during
    # the Hoenn story, with caves and side areas beside their nearest route.
    progression = [
        "MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB", "MAP_ROUTE101", "MAP_EVOLUTION_CAVE", "MAP_EVOLUTION_CAVE_2",
        "MAP_ROUTE103", "MAP_ROUTE102",
        "MAP_PETALBURG_CITY", "MAP_ROUTE104", "MAP_PETALBURG_WOODS",
        "MAP_ROUTE116", "MAP_RUSTBORO_CITY_GYM", "MAP_RUSTBORO_CITY_DEVON_CORP_2F",
        "MAP_RUSTURF_TUNNEL", "MAP_DEWFORD_TOWN", "MAP_DEWFORD_TOWN_GYM", "MAP_ROUTE106",
        "MAP_GRANITE_CAVE_1F", "MAP_GRANITE_CAVE_B1F", "MAP_GRANITE_CAVE_B2F", "MAP_GRANITE_CAVE_STEVENS_ROOM",
        "MAP_ROUTE107", "MAP_ROUTE108", "MAP_ABANDONED_SHIP_ROOMS_B1F", "MAP_ABANDONED_SHIP_HIDDEN_FLOOR_CORRIDORS",
        "MAP_ROUTE109", "MAP_SLATEPORT_CITY", "MAP_ROUTE110", "MAP_MAUVILLE_CITY_GYM", "MAP_ROUTE117", "MAP_NEW_MAUVILLE_ENTRANCE",
        "MAP_NEW_MAUVILLE_INSIDE", "MAP_ROUTE111",
        "MAP_MIRAGE_TOWER_1F", "MAP_MIRAGE_TOWER_2F", "MAP_MIRAGE_TOWER_3F", "MAP_MIRAGE_TOWER_4F",
        "MAP_DESERT_UNDERPASS", "MAP_ROUTE112", "MAP_FIERY_PATH", "MAP_ROUTE113", "MAP_ROUTE114",
        "MAP_METEOR_FALLS_1F_1R", "MAP_METEOR_FALLS_1F_2R", "MAP_METEOR_FALLS_B1F_1R",
        "MAP_METEOR_FALLS_B1F_2R", "MAP_METEOR_FALLS_STEVENS_CAVE", "MAP_METEOR_FALLS_URSHIFU", "MAP_JAGGED_PASS",
        "MAP_LAVARIDGE_TOWN_GYM_1F", "MAP_PETALBURG_CITY_GYM",
        "MAP_MAGMA_HIDEOUT_1F", "MAP_MAGMA_HIDEOUT_2F_1R", "MAP_MAGMA_HIDEOUT_2F_2R",
        "MAP_MAGMA_HIDEOUT_2F_3R", "MAP_MAGMA_HIDEOUT_3F_1R", "MAP_MAGMA_HIDEOUT_3F_2R",
        "MAP_MAGMA_HIDEOUT_3F_3R", "MAP_MAGMA_HIDEOUT_4F", "MAP_ROUTE115", "MAP_ROUTE105",
        "MAP_ROUTE118", "MAP_ROUTE119", "MAP_ROUTE119_WEATHER_INSTITUTE_2F", "MAP_ROUTE120",
        "MAP_FORTREE_CITY_GYM", "MAP_ROUTE121",
        "MAP_SAFARI_ZONE_SOUTH", "MAP_SAFARI_ZONE_SOUTHWEST", "MAP_SAFARI_ZONE_SOUTHEAST",
        "MAP_SAFARI_ZONE_NORTH", "MAP_SAFARI_ZONE_NORTHWEST", "MAP_SAFARI_ZONE_NORTHEAST",
        "MAP_LILYCOVE_CITY", "MAP_AQUA_HIDEOUT_B1F", "MAP_ROUTE122", "MAP_MT_PYRE_EXTERIOR", "MAP_MT_PYRE_1F",
        "MAP_MT_PYRE_2F", "MAP_MT_PYRE_3F", "MAP_MT_PYRE_4F", "MAP_MT_PYRE_5F", "MAP_MT_PYRE_6F",
        "MAP_MT_PYRE_SUMMIT", "MAP_ROUTE123", "MAP_ROUTE124", "MAP_MOSSDEEP_CITY", "MAP_MOSSDEEP_CITY_STEVENS_HOUSE",
        "MAP_ROUTE125", "MAP_MOSSDEEP_CITY_GYM", "MAP_MOSSDEEP_CITY_SPACE_CENTER_2F",
        "MAP_SHOAL_CAVE_LOW_TIDE_ENTRANCE_ROOM", "MAP_SHOAL_CAVE_LOW_TIDE_STAIRS_ROOM",
        "MAP_SHOAL_CAVE_LOW_TIDE_LOWER_ROOM", "MAP_SHOAL_CAVE_LOW_TIDE_INNER_ROOM", "MAP_SHOAL_CAVE_LOW_TIDE_ICE_ROOM",
        "MAP_ROUTE126", "MAP_UNDERWATER_ROUTE126", "MAP_SOOTOPOLIS_CITY", "MAP_SOOTOPOLIS_CITY_GYM_1F",
        "MAP_ROUTE127", "MAP_ROUTE128",
        "MAP_SEAFLOOR_CAVERN_ENTRANCE", "MAP_SEAFLOOR_CAVERN_ROOM1", "MAP_SEAFLOOR_CAVERN_ROOM2",
        "MAP_SEAFLOOR_CAVERN_ROOM3", "MAP_SEAFLOOR_CAVERN_ROOM4", "MAP_SEAFLOOR_CAVERN_ROOM5",
        "MAP_SEAFLOOR_CAVERN_ROOM6", "MAP_SEAFLOOR_CAVERN_ROOM7", "MAP_SEAFLOOR_CAVERN_ROOM8", "MAP_SEAFLOOR_CAVERN_ROOM9",
        "MAP_CAVE_OF_ORIGIN_ENTRANCE", "MAP_CAVE_OF_ORIGIN_1F", "MAP_CAVE_OF_ORIGIN_UNUSED_RUBY_SAPPHIRE_MAP1",
        "MAP_CAVE_OF_ORIGIN_UNUSED_RUBY_SAPPHIRE_MAP2", "MAP_CAVE_OF_ORIGIN_UNUSED_RUBY_SAPPHIRE_MAP3",
        "MAP_VICTORY_ROAD_1F", "MAP_VICTORY_ROAD_B1F", "MAP_VICTORY_ROAD_B2F", "MAP_EVER_GRANDE_CITY",
        "MAP_EVER_GRANDE_CITY_SIDNEYS_ROOM", "MAP_EVER_GRANDE_CITY_PHOEBES_ROOM",
        "MAP_EVER_GRANDE_CITY_GLACIAS_ROOM", "MAP_EVER_GRANDE_CITY_DRAKES_ROOM", "MAP_EVER_GRANDE_CITY_CHAMPIONS_ROOM",
        "MAP_ROUTE129", "MAP_ROUTE130", "MAP_ROUTE131", "MAP_PACIFIDLOG_TOWN",
        "MAP_SKY_PILLAR_1F", "MAP_SKY_PILLAR_3F", "MAP_SKY_PILLAR_5F", "MAP_SKY_PILLAR_TOP", "MAP_ROUTE132",
        "MAP_ROUTE133", "MAP_ROUTE134", "MAP_ROUTE135", "MAP_ROUTE136", "MAP_ROUTE137", "MAP_ROUTE138",
        "MAP_ROUTE140", "MAP_ROUTE141", "MAP_ROUTE142", "MAP_ROUTE135_ARCHIVES", "MAP_SS_TIDAL_ROOMS",
        "MAP_UNBORNE_ROOM", "MAP_DESERT_RUINS", "MAP_ISLAND_CAVE",
        "MAP_ANCIENT_TOMB", "MAP_TERRA_CAVE_END", "MAP_MARINE_CAVE_END", "MAP_NEW_MAUVILLE_ENTRANCE",
        "MAP_SOUTHERN_ISLAND_INTERIOR", "MAP_BIRTH_ISLAND_EXTERIOR", "MAP_FARAWAY_ISLAND_INTERIOR",
        "MAP_NAVEL_ROCK_TOP", "MAP_NAVEL_ROCK_BOTTOM",
        "MAP_BATTLE_FRONTIER_OUTSIDE_EAST", "MAP_ALTERING_CAVE", "MAP_ARTISAN_CAVE_1F",
        "MAP_ARTISAN_CAVE_B1F"
    ]
    progression_rank = {map_id: index for index, map_id in enumerate(progression)}
    source_order = {area["id"]: index for index, area in enumerate(out)}
    out.sort(key=lambda area: (progression_rank.get(area["id"], len(progression)),
                               source_order.get(area["id"], 0), area["id"]))
    return merge_related_encounter_areas(out)

def merge_related_encounter_areas(areas):
    """Consolidate cave/building floors while retaining floor labels per method."""
    families = [
        ("MAP_ABANDONED_SHIP_", "MAP_ABANDONED_SHIP", "Abandoned Ship"),
        ("MAP_ARTISAN_CAVE_", "MAP_ARTISAN_CAVE", "Artisan Cave"),
        ("MAP_CAVE_OF_ORIGIN_", "MAP_CAVE_OF_ORIGIN", "Cave of Origin"),
        ("MAP_GRANITE_CAVE_", "MAP_GRANITE_CAVE", "Granite Cave"),
        ("MAP_MAGMA_HIDEOUT_", "MAP_MAGMA_HIDEOUT", "Magma Hideout"),
        ("MAP_METEOR_FALLS_", "MAP_METEOR_FALLS", "Meteor Falls"),
        ("MAP_MIRAGE_TOWER_", "MAP_MIRAGE_TOWER", "Mirage Tower"),
        ("MAP_MT_PYRE_", "MAP_MT_PYRE", "Mt Pyre"),
        ("MAP_NEW_MAUVILLE_", "MAP_NEW_MAUVILLE", "New Mauville"),
        ("MAP_SEAFLOOR_CAVERN_", "MAP_SEAFLOOR_CAVERN", "Seafloor Cavern"),
        ("MAP_SHOAL_CAVE_LOW_TIDE_", "MAP_SHOAL_CAVE", "Shoal Cave"),
        ("MAP_SKY_PILLAR_", "MAP_SKY_PILLAR", "Sky Pillar"),
        ("MAP_VICTORY_ROAD_", "MAP_VICTORY_ROAD", "Victory Road")
    ]
    merged = {}
    for area in areas:
        map_id = area["id"]
        group_id, group_name, subsection = map_id, area["name"], ""
        if map_id == "MAP_ALTERING_CAVE":
            group_id, group_name = map_id, "Altering Cave"
        else:
            for prefix, canonical_id, canonical_name in families:
                if map_id.startswith(prefix):
                    group_id, group_name = canonical_id, canonical_name
                    subsection = map_id[len(prefix):]
                    break
        if group_id not in merged:
            merged[group_id] = {
                "id": group_id,
                "name": group_name,
                "mapType": area.get("mapType", ""),
                "gameRegion": area.get("gameRegion", ""),
                "region": area.get("region", ""),
                "methods": []
            }
        label = format_encounter_subsection(subsection) if subsection else ""
        for method in area.get("methods", []):
            copy = dict(method)
            if label:
                copy["name"] = label + " · " + copy["name"]
            merged[group_id]["methods"].append(copy)
    return list(merged.values())

def format_encounter_subsection(value):
    labels = {
        "EXTERIOR": "Exterior", "SUMMIT": "Summit", "ENTRANCE": "Entrance",
        "ENTRANCE_ROOM": "Entrance Room", "INSIDE": "Inside", "STEVENS_ROOM": "Steven's Room",
        "STEVENS_CAVE": "Steven's Cave", "URSHIFU": "Urshifu Cave", "LOW_TIDE_ENTRANCE_ROOM": "Low Tide · Entrance Room",
        "LOW_TIDE_STAIRS_ROOM": "Low Tide · Stairs Room", "LOW_TIDE_LOWER_ROOM": "Low Tide · Lower Room",
        "LOW_TIDE_INNER_ROOM": "Low Tide · Inner Room", "LOW_TIDE_ICE_ROOM": "Low Tide · Ice Room"
    }
    if value in labels:
        return labels[value]
    unused = re.match(r'UNUSED_RUBY_SAPPHIRE_MAP(\d+)$', value)
    if unused:
        return "Unused Ruby/Sapphire Map " + unused.group(1)
    floor = re.match(r'^(B?\d+F)(?:_(\d+)R)?$', value)
    if floor:
        return floor.group(1) + (" · Room " + floor.group(2) if floor.group(2) else "")
    room = re.match(r'^ROOM(\d+)$', value)
    if room:
        return "Room " + room.group(1)
    return value.replace('_', ' ').title()

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 extract_data.py /path/to/repo")
        sys.exit(1)
    repo = sys.argv[1]
    if not os.path.isdir(repo):
        print("Not a directory:", repo)
        sys.exit(1)

    print("Reading constants...")
    species_const_text = find_source(repo, "include/constants/species.h")
    moves_const_text = find_source(repo, "include/constants/moves.h")
    abilities_const_text = find_source(repo, "include/constants/abilities.h")
    items_const_text = find_source(repo, "include/constants/items.h")
    pokemon_const_text = find_source(repo, "include/constants/pokemon.h")
    pokedex_const_text = find_source(repo, "include/constants/pokedex.h")
    shiny_odds_match = re.search(r'^\s*#define\s+SHINY_ODDS\s+(\d+)', pokemon_const_text, re.MULTILINE)
    shiny_odds = int(shiny_odds_match.group(1)) if shiny_odds_match else 8

    species_ids = parse_constants(species_const_text, "SPECIES_")
    move_ids = parse_constants(moves_const_text, "MOVE_")
    ability_ids = parse_constants(abilities_const_text, "ABILITY_")
    item_ids = parse_constants(items_const_text, "ITEM_")
    national_dex_ids = parse_constants(pokedex_const_text, "NATIONAL_DEX_")

    print("  species constants:", len(species_ids))
    print("  move constants:", len(move_ids))
    print("  ability constants:", len(ability_ids))
    print("  item constants:", len(item_ids))

    print("Reading data tables (this can take a moment)...")
    species_text = find_source(repo, "src/data/pokemon/species_info.h", "src/data/pokemon/species_info")
    moves_text = find_source(repo, "src/data/moves_info.h", "src/data/moves_info")
    abilities_text = find_source(repo, "src/data/abilities.h", "src/data/abilities")
    items_text = find_source(repo, "src/data/items.h", "src/data/items")
    all_learnables = {}
    learnables_path = os.path.join(repo, "src/data/pokemon/all_learnables.json")
    if os.path.isfile(learnables_path):
        try:
            all_learnables = json.loads(read(learnables_path))
        except (ValueError, TypeError):
            all_learnables = {}

    species_blocks = extract_blocks(species_text, "SPECIES_")
    species_macros = extract_macro_definitions(species_text)
    pokedex_texts = build_pokedex_text_table(repo, species_text)
    move_blocks = extract_blocks(moves_text, "MOVE_")
    ability_blocks = extract_blocks(abilities_text, "ABILITY_")
    item_blocks = extract_blocks(items_text, "ITEM_")

    print("  species table entries found:", len(species_blocks))
    print("  move table entries found:", len(move_blocks))
    print("  ability table entries found:", len(ability_blocks))
    print("  item table entries found:", len(item_blocks))

    out_species = {}
    unresolved_species = 0
    with_types = 0
    with_abilities = 0
    first_block_sample = None
    for name, sid in species_ids.items():
        if sid == 0:
            continue
        block = species_blocks.get(name)
        if block is None:
            unresolved_species += 1
            continue
        data_block = add_invoked_species_macros(block, species_macros)
        if first_block_sample is None:
            first_block_sample = (name, block)
        display_name = extract_string_field(block, '.speciesName') or name.replace('_', ' ').title()
        types = extract_types(data_block)
        ability_names_raw = extract_abilities(data_block)
        ability_names = []
        for a in ability_names_raw:
            if a is None:
                ability_names.append(None)
                continue
            ab_block = ability_blocks.get(a)
            ab_name = extract_string_field(ab_block, '.name') if ab_block else None
            ability_names.append(ab_name or a.replace('_', ' ').title())
        growth = re.search(r'\.growthRate\s*=\s*GROWTH_([A-Za-z0-9_]+)', data_block)
        icon_sprite = re.search(r'\.iconSprite\s*=\s*gMonIcon_([A-Za-z0-9_]+)', data_block)
        nat_dex_match = re.search(r'\.natDexNum\s*=\s*NATIONAL_DEX_([A-Za-z0-9_]+)', data_block)
        nat_dex_name = nat_dex_match.group(1) if nat_dex_match else None
        national_dex = national_dex_ids.get(nat_dex_name, 0) if nat_dex_name else 0
        is_mega = bool(re.search(r'(^|_)MEGA(?:_|$)', name))
        is_gmax = bool(re.search(r'(^|_)(?:GMAX|GIGANTAMAX)(?:_|$)', name))
        form_label = None
        if is_mega:
            if name.endswith('_MEGA_X'):
                form_label = 'Mega X'
            elif name.endswith('_MEGA_Y'):
                form_label = 'Mega Y'
            else:
                form_label = 'Mega'
        elif is_gmax:
            form_label = 'Gigantamax'
        elif nat_dex_name and name != nat_dex_name and name.startswith(nat_dex_name + '_'):
            form_label = name[len(nat_dex_name) + 1:].replace('_', ' ').title()
        base_stats = []
        for stat_field in ('.baseHP', '.baseAttack', '.baseDefense', '.baseSpeed', '.baseSpAttack', '.baseSpDefense'):
            stat_match = re.search(re.escape(stat_field) + r'\s*=\s*(\d+)', data_block)
            base_stats.append(int(stat_match.group(1)) if stat_match else 1)
        friendship_match = re.search(r'\.friendship\s*=\s*(\d+)', data_block)
        gender_ratio = 127
        gender_match = re.search(r'\.genderRatio\s*=\s*PERCENT_FEMALE\((\d+(?:\.\d+)?)\)', data_block)
        if gender_match:
            gender_ratio = min(254, int(float(gender_match.group(1)) * 255 / 100))
        elif re.search(r'\.genderRatio\s*=\s*MON_GENDERLESS\b', data_block):
            gender_ratio = 255
        elif re.search(r'\.genderRatio\s*=\s*MON_FEMALE\b', data_block):
            gender_ratio = 254
        elif re.search(r'\.genderRatio\s*=\s*MON_MALE\b', data_block):
            gender_ratio = 0
        if types: with_types += 1
        if ability_names: with_abilities += 1
        inline_description = extract_compound_field(data_block, '.description')
        description_symbol = re.search(r'\.description\s*=\s*(g[A-Za-z0-9_]+PokedexText)\b', data_block)
        pokedex_entry = inline_description or (pokedex_texts.get(description_symbol.group(1)) if description_symbol else None)
        out_species[str(sid)] = {
            "name": display_name,
            "types": types,
            "abilities": ability_names,
            "abilityIds": [ability_ids.get(a) for a in ability_names_raw if a and ability_ids.get(a)],
            "growthRate": growth.group(1).lower() if growth else None,
            "baseStats": base_stats,
            "friendship": int(friendship_match.group(1)) if friendship_match else 70,
            "genderRatio": gender_ratio,
            "iconSprite": icon_sprite.group(1) if icon_sprite else name.title(),
            "constant": name,
            "nationalDex": national_dex,
            "formLabel": form_label,
            "isMega": is_mega,
            "isGmax": is_gmax,
            "pokedexEntry": pokedex_entry
        }

    # Calculate the lowest level at which each species can exist by following
    # its evolution paths. Level-based evolutions use their specified threshold;
    # item/trade/friendship evolutions can happen at the parent's current level.
    evolution_edges = []
    incoming_evolutions = set()
    for constant, source_id in species_ids.items():
        block = species_blocks.get(constant)
        if not block:
            continue
        for evo in re.finditer(r'\{\s*(EVO_[A-Z0-9_]+)\s*,\s*([^,]+),\s*SPECIES_([A-Z0-9_]+)', block):
            method, parameter, target_constant = evo.groups()
            target_id = species_ids.get(target_constant)
            if source_id == 0 or target_id is None or str(source_id) not in out_species or str(target_id) not in out_species:
                continue
            threshold = 1
            if method.startswith("EVO_LEVEL"):
                level_match = re.search(r'\b(\d+)\b', parameter)
                threshold = int(level_match.group(1)) if level_match else 1
            evolution_edges.append((source_id, target_id, threshold))
            out_species[str(source_id)].setdefault("evolutions", []).append({
                "target": target_id,
                "method": method,
                "parameter": parameter.strip(),
            })
            incoming_evolutions.add(target_id)

    minimum_levels = {sid: (1 if sid not in incoming_evolutions else None) for sid in species_ids.values()
                      if sid and str(sid) in out_species}
    for _ in range(len(minimum_levels)):
        changed = False
        for source_id, target_id, threshold in evolution_edges:
            source_level = minimum_levels.get(source_id)
            if source_level is None:
                continue
            candidate = max(source_level, threshold)
            target_level = minimum_levels.get(target_id)
            if target_level is None or candidate < target_level:
                minimum_levels[target_id] = candidate
                changed = True
        if not changed:
            break
    for sid, species in out_species.items():
        species["minimumLevel"] = minimum_levels.get(int(sid)) or 1

    out_moves = {}
    out_move_pp = {}
    move_details = {}
    move_flag_fields = (
        "makesContact", "punchingMove", "bitingMove", "ballisticMove", "soundMove",
        "powderMove", "danceMove", "slicingMove", "windMove", "snatchAffected",
        "magicCoatAffected", "protectAffected", "mirrorMoveBanned", "metronomeBanned",
        "sketchBanned", "assistBanned"
    )
    for name, mid in move_ids.items():
        if mid == 0:
            continue
        block = move_blocks.get(name)
        move_name = extract_string_field(block, '.name') if block else None
        display_move_name = move_name or name.replace('_', ' ').title()
        out_moves[str(mid)] = display_move_name
        pp = extract_numeric_field(block, '.pp', 0) if block else 0
        out_move_pp[str(mid)] = pp or 0
        type_constant = extract_enum_field(block, '.type', 'TYPE_') if block else None
        category_constant = extract_enum_field(block, '.category', 'DAMAGE_CATEGORY_') if block else None
        target_constant = extract_enum_field(block, '.target', 'TARGET_') if block else None
        effect_constant = extract_enum_field(block, '.effect', 'EFFECT_') if block else None
        flags = []
        if block:
            for flag in move_flag_fields:
                if re.search(r'\.' + re.escape(flag) + r'\s*=\s*TRUE\b', block):
                    flags.append(re.sub(r'(?<!^)(?=[A-Z])', ' ', flag).title())
        move_details[str(mid)] = {
            "name": display_move_name,
            "constant": "MOVE_" + name,
            "description": extract_compound_field(block, '.description') if block else None,
            "power": extract_numeric_field(block, '.power', 0) if block else 0,
            "accuracy": extract_numeric_field(block, '.accuracy', 0) if block else 0,
            "pp": pp or 0,
            "priority": extract_numeric_field(block, '.priority', 0) if block else 0,
            "type": TYPE_NAMES.get(type_constant) if type_constant else None,
            "category": pretty_constant(category_constant) if category_constant else None,
            "target": pretty_constant(target_constant) if target_constant else None,
            "effect": pretty_constant(effect_constant) if effect_constant else None,
            "flags": flags,
        }

    # Build a species-specific pool from every move that species can learn.
    # Form constants fall back through their underscore-separated parent names.
    for species in out_species.values():
        constant = species.get("constant", "")
        learnable = all_learnables.get(constant)
        parent = constant
        while learnable is None and '_' in parent:
            parent = parent.rsplit('_', 1)[0]
            learnable = all_learnables.get(parent)
        numeric_moves = []
        for move_constant in learnable or []:
            move_name = move_constant.removeprefix("MOVE_")
            move_id = move_ids.get(move_name)
            if move_id and move_id < 2048 and str(move_id) in out_moves and move_id not in numeric_moves:
                numeric_moves.append(move_id)
        species["learnableMoves"] = numeric_moves

    out_abilities = {}
    ability_details = {}
    ability_flag_fields = (
        "breakable", "cantBeSwapped", "cantBeTraced", "cantBeCopied",
        "cantBeSuppressed", "cantBeOverwritten", "failsOnImposter",
        "suppressesWeather"
    )
    for name, aid in ability_ids.items():
        if aid == 0:
            continue
        block = ability_blocks.get(name)
        ab_name = extract_string_field(block, '.name') if block else None
        display_ability_name = ab_name or name.replace('_', ' ').title()
        out_abilities[str(aid)] = display_ability_name
        flags = []
        if block:
            for flag in ability_flag_fields:
                if re.search(r'\.' + re.escape(flag) + r'\s*=\s*TRUE\b', block):
                    flags.append(re.sub(r'(?<!^)(?=[A-Z])', ' ', flag).title())
        ability_details[str(aid)] = {
            "name": display_ability_name,
            "constant": "ABILITY_" + name,
            "description": extract_compound_field(block, '.description') if block else None,
            "aiRating": extract_numeric_field(block, '.aiRating', None) if block else None,
            "flags": flags,
        }

    trainer_locations, item_locations = extract_reference_locations(repo)

    out_items = {}
    item_details = {}
    for name, iid in item_ids.items():
        if iid == 0:
            continue
        block = item_blocks.get(name)
        item_name = extract_string_field(block, '.name') if block else None
        display_item_name = item_name or name.replace('_', ' ').title()
        out_items[str(iid)] = display_item_name
        icon_match = re.search(r'\.iconPic\s*=\s*gItemIcon_([A-Za-z0-9_]+)', block or "")
        item_details[str(iid)] = {
            "name": display_item_name,
            "constant": "ITEM_" + name,
            "description": extract_compound_field(block, '.description') if block else None,
            "locations": item_locations.get("ITEM_" + name, []),
            "iconKey": icon_match.group(1) if icon_match else None
        }

    route_encounters = extract_route_encounters(repo, species_ids)
    trainer_teams = extract_trainer_teams(repo)
    change_catalog = extract_feature_catalog(repo)
    for trainer in trainer_teams:
        trainer["locations"] = trainer_locations.get(trainer["constant"], [])
    data = {"species": out_species, "moves": out_moves, "movePP": out_move_pp, "moveDetails": move_details,
            "abilities": out_abilities, "abilityDetails": ability_details, "items": out_items, "itemDetails": item_details, "routeEncounters": route_encounters,
            "changes": change_catalog, "shinyOdds": shiny_odds}
    with open("brisk-dex-data.json", "w", encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    with open("brisk-dex-trainer-teams.json", "w", encoding='utf-8') as f:
        json.dump({"source": "Pokemon-Brisk-Emerald/src/data/trainers.party", "trainers": trainer_teams},
                  f, ensure_ascii=False, separators=(',', ':'))

    print()
    print("Wrote brisk-dex-data.json:")
    print("  species:", len(out_species), "  (unresolved constants with no matching table entry:", unresolved_species, ")")
    print("  species with types resolved:", with_types, "/", len(out_species))
    print("  species with abilities resolved:", with_abilities, "/", len(out_species))
    print("  moves:", len(out_moves))
    print("  abilities:", len(out_abilities))
    print("  items:", len(out_items))
    print("  locations with wild encounters:", len(route_encounters))
    print("  trainers:", len(trainer_teams), "  pokemon on trainer teams:", sum(len(t["party"]) for t in trainer_teams))

    if first_block_sample and (with_types < len(out_species) * 0.5 or with_abilities < len(out_species) * 0.5):
        with open("debug_sample_species_block.txt", "w", encoding='utf-8') as f:
            f.write("Species: " + first_block_sample[0] + "\n\n" + first_block_sample[1][:2000])
        print()
        print("  Types or abilities are resolving for less than half of species --")
        print("  wrote a raw sample block to debug_sample_species_block.txt.")
        print("  Paste its contents back and I can fix the pattern directly.")

    # ---- icons ----
    gfx_dir = os.path.join(repo, "graphics", "pokemon")
    icons_out = "brisk-dex-icons"
    if os.path.isdir(gfx_dir):
        os.makedirs(icons_out, exist_ok=True)
        for filename in os.listdir(icons_out):
            if re.match(r'^\d+(?:_shiny)?\.png$', filename, re.I):
                os.remove(os.path.join(icons_out, filename))
        found = 0
        shiny_found = 0
        by_sprite = {}
        for root, _, files in os.walk(gfx_dir):
            if "icon.png" not in files:
                continue
            rel = os.path.relpath(root, gfx_dir)
            sprite_key = re.sub(r'[_-]', '', rel.replace(os.sep, '')).lower()
            by_sprite[sprite_key] = root
            # Some species use a shortened form name in .iconSprite while
            # their directory spells the same form with a suffix such as
            # "_percent" (for example Zygarde10 -> zygarde/10_percent).
            short_form_rel = re.sub(r'_percent(?=$|[\\/])', '', rel, flags=re.I)
            short_form_key = re.sub(r'[_-]', '', short_form_rel.replace(os.sep, '')).lower()
            if short_form_key != sprite_key:
                by_sprite.setdefault(short_form_key, root)
            if sprite_key == 'zygarde':
                by_sprite.setdefault('zygarde50', root)

        for sid, species in out_species.items():
            sprite_name = species.get("iconSprite") or species.get("constant", "").replace("_", "").title()
            sprite_key = re.sub(r'[_-]', '', sprite_name).lower()
            folder = by_sprite.get(sprite_key)
            if not folder:
                parts = re.findall(r'[A-Z]?[a-z0-9]+|[A-Z]+(?=[A-Z]|$)', sprite_name)
                while len(parts) > 1 and not folder:
                    parts.pop()
                    folder = by_sprite.get(''.join(parts).lower())
            if not folder:
                continue
            icon_path = os.path.join(folder, "icon.png")
            shutil.copyfile(icon_path, os.path.join(icons_out, sid + ".png"))
            shiny_path = os.path.join(folder, "icon_shiny.png")
            if os.path.isfile(shiny_path):
                shutil.copyfile(shiny_path, os.path.join(icons_out, sid + "_shiny.png"))
            else:
                # Form directories often contain their own icon and shiny
                # palette but inherit the animated front sprite from the base
                # species directory (Deerling seasons are an example). Resolve
                # the nearest sprite and nearest palette independently so
                # regional and cosmetic forms keep their own shiny colors.
                current = folder
                front_path = None
                palette_path = None
                normal_palette_path = None
                while True:
                    candidate_front = os.path.join(current, "anim_front.png")
                    if not os.path.isfile(candidate_front):
                        # Some regional and special forms ship a static front.png
                        # instead of an animated two-frame sheet. Prefer that
                        # form-local art over the base species' animated sprite.
                        candidate_front = os.path.join(current, "front.png")
                    candidate_palette = os.path.join(current, "shiny.pal")
                    candidate_normal_palette = os.path.join(current, "normal.pal")
                    if front_path is None and os.path.isfile(candidate_front):
                        front_path = candidate_front
                    if palette_path is None and os.path.isfile(candidate_palette):
                        palette_path = candidate_palette
                    if normal_palette_path is None and os.path.isfile(candidate_normal_palette):
                        normal_palette_path = candidate_normal_palette
                    if front_path and palette_path and normal_palette_path:
                        break
                    if os.path.abspath(current) == os.path.abspath(gfx_dir):
                        break
                    current = os.path.dirname(current)
                if front_path and palette_path and normal_palette_path and palette_variant_png(
                        front_path, normal_palette_path, palette_path, True,
                        os.path.join(icons_out, sid + "_shiny.png")):
                    shiny_found += 1
            found += 1
        print()
        print("Copied", found, "icon PNGs into ./" + icons_out + "/ (named by species id)")
        print("Generated", shiny_found, "shiny sprite sheets using Brisk Emerald's species palettes")
        if found == 0:
            print("  No icons matched automatically -- check that graphics/pokemon/<name>/icon.png exists")
            print("  and that <name> corresponds to the SPECIES_ constant (case-insensitive, underscores ignored).")
    else:
        print()
        print("No graphics/pokemon folder found at", gfx_dir, "-- skipping icon export.")

    # Export item icons using the exact graphics symbol referenced by each item.
    item_graphics_text = find_source(repo, "src/data/graphics/items.h")
    item_icon_sources = {}
    for match in re.finditer(r'const\s+u32\s+gItemIcon_([A-Za-z0-9_]+)\[\]\s*=\s*INCGFX_U32\("([^"]+\.png)"', item_graphics_text or ""):
        item_icon_sources[match.group(1)] = match.group(2)
    items_out = "brisk-dex-items"
    os.makedirs(items_out, exist_ok=True)
    for filename in os.listdir(items_out):
        if filename.endswith(".png"):
            os.remove(os.path.join(items_out, filename))
    for iid, details in item_details.items():
        rel = item_icon_sources.get(details.get("iconKey"))
        if not rel:
            continue
        source = os.path.join(repo, rel)
        if os.path.isfile(source):
            target = iid + ".png"
            normalize_sprite_png(source, os.path.join(items_out, target), transparent_bg=True)
            details["icon"] = items_out + "/" + target

    # Export front/back and shiny front/back species artwork for the Pokédex.
    sprites_out = "brisk-dex-sprites"
    os.makedirs(sprites_out, exist_ok=True)
    for filename in os.listdir(sprites_out):
        if filename.endswith(".png"):
            os.remove(os.path.join(sprites_out, filename))
    for sid, species in out_species.items():
        sprite_name = species.get("iconSprite") or species.get("constant", "").replace("_", "").title()
        sprite_key = re.sub(r'[_-]', '', sprite_name).lower()
        folder = by_sprite.get(sprite_key)
        if not folder:
            parts = re.findall(r'[A-Z]?[a-z0-9]+|[A-Z]+(?=[A-Z]|$)', sprite_name)
            while len(parts) > 1 and not folder:
                parts.pop()
                folder = by_sprite.get(''.join(parts).lower())
        if not folder:
            continue
        front_source = next((os.path.join(folder, fn) for fn in ("front.png", "anim_front.png") if os.path.isfile(os.path.join(folder, fn))), None)
        back_source = next((os.path.join(folder, fn) for fn in ("back.png", "anim_back.png") if os.path.isfile(os.path.join(folder, fn))), None)
        current = folder
        shiny_palette = normal_palette = None
        while True:
            if shiny_palette is None and os.path.isfile(os.path.join(current, "shiny.pal")):
                shiny_palette = os.path.join(current, "shiny.pal")
            if normal_palette is None and os.path.isfile(os.path.join(current, "normal.pal")):
                normal_palette = os.path.join(current, "normal.pal")
            if shiny_palette and normal_palette:
                break
            if os.path.abspath(current) == os.path.abspath(gfx_dir):
                break
            current = os.path.dirname(current)

        for side, source in (("front", front_source), ("back", back_source)):
            if not source:
                continue
            for want_shiny, suffix, field in (
                (False, "", side + "Sprite"),
                (True, "_shiny", side + "ShinySprite"),
            ):
                final = os.path.join(sprites_out, sid + "_" + side + suffix + ".png")
                temporary = os.path.join(sprites_out, sid + "_" + side + suffix + "_sheet.png")
                rendered = False
                if shiny_palette and normal_palette:
                    rendered = palette_variant_png(source, normal_palette, shiny_palette, want_shiny, temporary)
                if rendered:
                    normalize_sprite_png(temporary, final, first_frame=True, transparent_bg=True)
                    try:
                        os.remove(temporary)
                    except OSError:
                        pass
                elif not want_shiny:
                    normalize_sprite_png(source, final, first_frame=True, transparent_bg=True)
                    rendered = True
                if rendered or os.path.isfile(final):
                    species[field] = sprites_out + "/" + sid + "_" + side + suffix + ".png"

    # Export every trainer battle portrait referenced by trainers.party.
    trainer_front_dir = os.path.join(repo, "graphics", "trainers", "front_pics")
    trainer_pics_out = "brisk-dex-trainer-pics"
    os.makedirs(trainer_pics_out, exist_ok=True)
    for filename in os.listdir(trainer_pics_out):
        if filename.endswith(".png"):
            os.remove(os.path.join(trainer_pics_out, filename))
    if os.path.isdir(trainer_front_dir):
        available = {os.path.splitext(fn)[0].lower(): fn for fn in os.listdir(trainer_front_dir) if fn.lower().endswith(".png")}
        for trainer in trainer_teams:
            pic = (trainer.get("pic") or "").strip()
            key = re.sub(r'^TRAINER_PIC_(?:FRONT_)?', '', pic, flags=re.I).lower()
            key = key.replace(" ", "_")
            candidates = [key, key.replace("pkmn_", "pokemon_")]
            source_name = next((available[k] for k in candidates if k in available), None)
            if source_name:
                target = re.sub(r'[^a-z0-9_]+', '_', key) + ".png"
                shutil.copyfile(os.path.join(trainer_front_dir, source_name), os.path.join(trainer_pics_out, target))
                trainer["portrait"] = trainer_pics_out + "/" + target

    # Asset paths are added after the first JSON pass, so rewrite the generated
    # data files with item icon and trainer portrait references included.
    with open("brisk-dex-data.json", "w", encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    with open("brisk-dex-trainer-teams.json", "w", encoding='utf-8') as f:
        json.dump({"source": "Pokemon-Brisk-Emerald/src/data/trainers.party", "trainers": trainer_teams},
                  f, ensure_ascii=False, separators=(',', ':'))

    # The save stores the protagonist's gender. Bundle the matching Ruby/Sapphire
    # player sprite sheets for the trainer portrait in the app header.
    people_dir = os.path.join(repo, "graphics", "object_events", "pics", "people")
    trainers_out = "brisk-dex-trainers"
    if os.path.isdir(people_dir):
        os.makedirs(trainers_out, exist_ok=True)
        for source_name, target_name in (("rs_brendan.png", "male.png"), ("rs_may.png", "female.png")):
            source = os.path.join(people_dir, source_name)
            if os.path.isfile(source):
                shutil.copyfile(source, os.path.join(trainers_out, target_name))

    print()
    print("Done. Desktop builds load brisk-dex-data.json and brisk-dex-icons automatically.")

if __name__ == "__main__":
    main()
