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
    for line in match.group(1).splitlines():
        command = line.strip()
        if command.startswith('walk_') and command not in offsets and not command.startswith('walk_in_place'):
            raise RuntimeError('Unverified rescue movement ' + command)
        dx, dy = offsets.get(command, (0, 0))
        x, y = x + dx, y + dy
        if label == 'Route101_Movement_EnterScene':
            safe = 10 <= x <= 11 and 18 <= y <= 19
        elif label == 'Route101_Movement_BirchApproachPlayer':
            safe = y == 16 and x in (10, 11)
        else:
            # Original reference poses must not drift after the rescue trigger.
            safe = (x, y) == position
        if not safe:
            raise RuntimeError(f'{label} drifts off its expected reference tile at {x},{y}')
    return x, y


def check_route101(checkout):
    route = json.loads((checkout / 'data/maps/Route101/map.json').read_text())
    layouts = json.loads((checkout / 'data/layouts/layouts.json').read_text())['layouts']
    layout = next(item for item in layouts if item['id'] == route['layout'])
    for family in ('object_events', 'coord_events', 'warp_events', 'bg_events'):
        for event in route.get(family, []):
            if not (0 <= event['x'] < layout['width'] and 0 <= event['y'] < layout['height']):
                raise RuntimeError(f'Route 101 {family} references outside map: {event["x"]},{event["y"]}')
    bag = next(event for event in route['object_events']
               if event['graphics_id'] == 'OBJ_EVENT_GFX_BIRCHS_BAG')
    if (bag['x'], bag['y']) != (10, 17):
        raise RuntimeError('Birch bag must remain at its existing location')
    triggers = [(event['x'], event['y'], event['var_value'])
                for event in route['coord_events'] if event.get('var') == 'VAR_ROUTE101_STATE']
    if triggers != [(10, 19, '1'), (11, 19, '1'), (10, 19, '2'), (11, 19, '2')]:
        raise RuntimeError('Route 101 player rescue/exit triggers changed')
    script = (checkout / 'data/maps/Route101/scripts.inc').read_text()
    rescue = script.split('Route101_EventScript_StartBirchRescue::\n', 1)[1].split('\n\tend', 1)[0]
    bag_event = script.split('Route101_EventScript_BirchsBag::\n', 1)[1].split('\n\tend', 1)[0]
    actors = {e['local_id']: e for e in route['object_events'] if 'local_id' in e}

    def spawn(local_id):
        matches = re.findall(r'^\s*setobjectxy ' + re.escape(local_id)
                             + r',\s*(\d+),\s*(\d+)$', rescue, re.M)
        if len(matches) != 1:
            raise RuntimeError('Missing or duplicated rescue position: ' + local_id)
        return tuple(map(int, matches[0]))

    for local_id, expected in (
        ('LOCALID_ROUTE101_BIRCH', (8, 15)),
        ('LOCALID_ROUTE101_ZIGZAGOON', (9, 15)),
    ):
        actor = actors[local_id]
        if (actor['x'], actor['y']) != expected or actor['elevation'] != 3:
            raise RuntimeError('Map spawn differs from original Brisk: ' + local_id)
        if spawn(local_id) != expected:
            raise RuntimeError('Rescue script overrides original coordinates: ' + local_id)
    # Keep actors facing each other after the rescue, without changing tiles.
    for local_id, default_facing in (
        ('LOCALID_ROUTE101_BIRCH', 'MOVEMENT_TYPE_JOG_IN_PLACE_RIGHT'),
        ('LOCALID_ROUTE101_ZIGZAGOON', 'MOVEMENT_TYPE_JOG_IN_PLACE_LEFT'),
    ):
        if actors[local_id]['movement_type'] != default_facing:
            raise RuntimeError('Route 101 default NPC facing is wrong: ' + local_id)
    for label, facing in (
        ('Route101_Movement_BirchFaceZigzagoon', 'walk_in_place_fast_right'),
        ('Route101_Movement_ZigzagoonFaceBirch', 'walk_in_place_fast_left'),
    ):
        match = re.search(r'^' + re.escape(label) + r':\n(.*?)\tstep_end', script, re.M | re.S)
        if not match:
            raise RuntimeError('Missing final rescue direction: ' + label)
        moves = [line.strip() for line in match.group(1).splitlines()
                 if line.strip().startswith('walk_')]
        if moves != [facing]:
            raise RuntimeError('Route 101 NPCs must face one another: ' + label)
    birch = (8, 15)
    zigzagoon = (9, 15)
    birch = movement(script, 'Route101_Movement_BirchRunAway1', birch)
    zigzagoon = movement(script, 'Route101_Movement_ZigzagoonChase1', zigzagoon)
    birch = movement(script, 'Route101_Movement_BirchRunInCircles', birch)
    zigzagoon = movement(script, 'Route101_Movement_ZigzagoonChaseInCircles', zigzagoon)
    if birch != (8, 15) or zigzagoon != (9, 15):
        raise RuntimeError('Chase moves actors off their original Brisk positions')
    if 'Route101_Movement_ZigzagoonStepSouth' in script or 'Route101_Movement_BirchStepNorth' in script:
        raise RuntimeError('Legacy rescue movement still displaces the original NPCs')
    if not re.search(r'^\s*setobjectxy LOCALID_ROUTE101_BIRCH, 11, 16\s*$', bag_event, re.M):
        raise RuntimeError('Missing Birch reposition after the game fades for starter selection')
    if bag_event.find('setobjectxy LOCALID_ROUTE101_BIRCH, 11, 16') > bag_event.find('StartNewPokeballCaseUI'):
        raise RuntimeError('Birch must reposition while the field is faded out')
    if movement(script, 'Route101_Movement_BirchApproachPlayer', (11, 16)) != (10, 16):
        raise RuntimeError('Birch cannot safely approach unchanged starter bag')
    for starting in ((10, 19), (11, 19)):
        if movement(script, 'Route101_Movement_EnterScene', starting) != (starting[0], 18):
            raise RuntimeError('Player leaves unchanged rescue approach')
    print('Route 101: original Birch (8,15) and Zigzagoon (9,15), bag and player triggers unchanged')



def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 tools/test_native_event_parity.py <native-checkout>')
    checkout = Path(sys.argv[1]).resolve()
    config = json.loads((Path(__file__).parent / 'brisk-native-source.json').read_text())
    check_import(checkout, config)
    check_route101(checkout)


if __name__ == '__main__':
    main()
