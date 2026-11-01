#!/usr/bin/env python3
"""Stage game identity beside the private runtime after successful compilation."""
import argparse
import json
from pathlib import Path


def stage(destination, source, profile, native_commit):
    if profile == 'brisk':
        report = json.loads((source / 'BRISK_NATIVE_SOURCE.json').read_text())
        if report.get('profile') != 'brisk' or report.get('native_commit') != native_commit:
            raise RuntimeError('Brisk source identity does not match the compiled native engine')
        info = {'profile': 'brisk', 'game_name': 'Pokémon Brisk Emerald',
                'native_commit': native_commit, 'brisk_commit': report['brisk_commit'],
                'brisk_changed_files': report['brisk_changed_files'],
                'heap_bytes': 16 * 1024 * 1024, 'save_layout_id': 0x42524B31}
    elif profile == 'expansion':
        info = {'profile': 'expansion', 'game_name': 'Pokémon Emerald — Native Expansion',
                'native_commit': native_commit, 'heap_bytes': 0x1C500, 'save_layout_id': 1}
    else:
        raise ValueError('Unknown native game profile')
    info['embedded_protocol'] = 2
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'build-info.json').write_text(json.dumps(info, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    parser.add_argument('source', type=Path)
    parser.add_argument('profile', choices=['brisk', 'expansion'])
    parser.add_argument('native_commit')
    args = parser.parse_args()
    stage(args.destination, args.source, args.profile, args.native_commit)
