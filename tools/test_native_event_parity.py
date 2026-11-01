#!/usr/bin/env python3
"""Guard Brisk overworld and event content when compiling the native game.

Verifies all Brisk-modified map and event assets are imported byte-for-byte,
except the native-only debug script. Also checks Route 101 rescue choreography.
This is static validation; an end-to-end gameplay test remains necessary.
"""
import json
from pathlib import Path
import re
import sys
from prepare_brisk_native import Blobs, tree


def check_import(checkout, config):
    base = tree(checkout, config['expansion_base'])
    brisk = tree(checkout, config['brisk_commit'])
    changed = sorted(name for name in set(base) | set(brisk)
                     if base.get(name) != brisk.get(name)
                     and (name.startswith(('data/maps/', 'data/scripts/'))
                          or name in ('data/event_scripts.s', 'data/map_groups.json'))
                     and name != 'data/scripts/debug.inc')
    errors = []
    blobs = Blobs(checkout)
    try:
        for name in changed:
            target = checkout / name
            if name not in brisk:
                if target.exists():
                    errors.append(name + ' (Brisk deleted it)')
            elif not target.is_file() or target.read_bytes() != blobs.get(brisk[name][1]):
                errors.append(name + ' (different from Brisk)')
    finally:
        blobs.close()
    if errors:
        raise RuntimeError('Native import altered Brisk event/map content: ' + ', '.join(errors[:15]))
    print('Native event source parity:', len(changed), 'modified map and event assets identical')


def movement(script, label, position):
    match = re.search(r'^' + re.escape(label) + r':\n(.*?)\tstep_end', script, re.M | re.S)
    if not match:
        raise RuntimeError('Missing movement ' + label)
    x, y = position
    offsets = {'walk_fast_left': (-1, 0), 'walk_fast_right': (1, 0),
               'walk_fast_up': (0, -1), 'walk_fast_down': (0, 1)}
    for cmd in match.group(1).splitlines():
        cmd = cmd.strip()
        if cmd.startswith('walk_') and cmd not in offsets and not cmd.startswith('walk_in_place'):
            raise RuntimeError('Unverified rescue step ' + cmd)
        dx, dy = offsets.get(cmd, (0, 0))
        x, y = x + dx, y + dy
        if label == 'Route101_Movement_EnterScene':
            safe = 10 <= x <= 11 and 18 <= y <= 19
        elif label in ('Route101_Movement_BirchStepNorth', 'Route101_Movement_BirchStepSouth'):
            safe = x == 13 and y in (15, 16)
        else:
            safe = 10 <= x <= 13 and y == 16
        if not safe:
            raise RuntimeError(f'{label} leaves the intended Route 101 corridor at {x},{y}')
    return x, y


def check_route101(checkout):
    route = json.loads((checkout / 'data/maps/Route101/map.json').read_text())
    layouts = json.loads((checkout / 'data/layouts/layouts.json').read_text())['layouts']
    layout = next(x for x in layouts if x['id'] == route['layout'])
    for key in ('object_events', 'coord_events', 'warp_events', 'bg_events'):
        for event in route.get(key, []):
            if not (0 <= event['x'] < layout['width'] and 0 <= event['y'] < layout['height']):
                raise RuntimeError(f'Route 101 {key}: out-of-bounds event {event["x"]},{event["y"]}')
    triggers = [(e['x'], e['y']) for e in route['coord_events']
                if e.get('var') == 'VAR_ROUTE101_STATE']
    if triggers != [(10, 19), (11, 19), (10, 19), (11, 19)]:
        raise RuntimeError('Route 101 rescue triggers are incorrectly positioned')
    script = (checkout / 'data/maps/Route101/scripts.inc').read_text()
    scene_order = ['Route101_Movement_BirchRunInCircles', 'Route101_Movement_BirchFaceZigzagoon',
                   'Route101_Movement_BirchStepNorth', 'Route101_Text_PleaseHelp']
    rescue = script.split('Route101_EventScript_StartBirchRescue::\n', 1)[1].split('\n\tend', 1)[0]
    positions = [rescue.find(token) for token in scene_order]
    if -1 in positions or positions != sorted(positions):
        raise RuntimeError('Birch north-facing stage is not after the rescue chase')
    bag = script.split('Route101_EventScript_BirchsBag::\n', 1)[1].split('\n\tend', 1)[0]
    if not bag.find('Route101_Movement_BirchStepSouth') < bag.find('Route101_Movement_BirchApproachPlayer') or 'Route101_Movement_BirchStepSouth' not in bag:
        raise RuntimeError('Birch has no safe transition back before meeting player')
    scene = script.split('Route101_EventScript_StartBirchRescue::\n', 1)[1].split('\n\tend', 1)[0]
    def spawn(actor):
        matches = re.findall(r'^\s*setobjectxy ' + re.escape(actor) + r',\s*(\d+),\s*(\d+)$', scene, re.M)
        if len(matches) != 1:
            raise RuntimeError('Missing rescue actor: ' + actor)
        return tuple(map(int, matches[0]))
    actors = {event['local_id']: event for event in route['object_events'] if 'local_id' in event}
    for local, expected in [('LOCALID_ROUTE101_BIRCH',(11,16)),('LOCALID_ROUTE101_ZIGZAGOON',(10,16))]:
        actor = actors[local]
        if (actor['x'],actor['y']) != expected or actor['elevation'] != 3:
            raise RuntimeError('Route 101 physical NPC spawn does not match safe rescue corridor')
    birch = spawn('LOCALID_ROUTE101_BIRCH')
    zig = spawn('LOCALID_ROUTE101_ZIGZAGOON')
    if birch != (11, 16) or zig != (10, 16):
        raise RuntimeError('Birch and Zigzagoon are no longer on the accessible side of the cliff')
    birch = movement(script, 'Route101_Movement_BirchRunAway1', birch)
    zig = movement(script, 'Route101_Movement_ZigzagoonChase1', zig)
    birch = movement(script, 'Route101_Movement_BirchRunInCircles', birch)
    zig = movement(script, 'Route101_Movement_ZigzagoonChaseInCircles', zig)
    if birch != (13, 16) or zig != (12, 16):
        raise RuntimeError('Rescue chase ends outside the intended area')
    # Do not shift Birch's entire chase onto the western cliff; he steps north
    # only after the chase and returns to the walkable row before approaching.
    birch = movement(script, 'Route101_Movement_BirchStepNorth', birch)
    if birch != (13, 15):
        raise RuntimeError('Birch is not raised a tile for his rescue dialogue')
    birch = movement(script, 'Route101_Movement_BirchStepSouth', birch)
    if birch != (13, 16):
        raise RuntimeError('Birch did not return to the approach corridor')
    # The introductory movement must stop below the bag, not walk onto a cliff.
    if movement(script, 'Route101_Movement_EnterScene', (10, 19)) != (10, 18):
        raise RuntimeError('Player is displaced from the lower starter-bag approach')
    if movement(script, 'Route101_Movement_EnterScene', (11, 19)) != (11, 18):
        raise RuntimeError('Second rescue trigger displaces the player')
    if movement(script, 'Route101_Movement_BirchApproachPlayer', birch) != (11, 16):
        raise RuntimeError('Birch cannot approach the player after the starter selection')
    print('Route 101 event: trigger, actor positions and movement path valid')


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 tools/test_native_event_parity.py <native-checkout>')
    checkout = Path(sys.argv[1]).resolve()
    config = json.loads((Path(__file__).parent / 'brisk-native-source.json').read_text())
    check_import(checkout, config)
    check_route101(checkout)


if __name__ == '__main__':
    main()
