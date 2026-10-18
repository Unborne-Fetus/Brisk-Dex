"""Refresh the existing lazy graphic packs; optionally compact generated git changes."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

MEDIA = ('brisk-dex-icons', 'brisk-dex-sprites')

def package(root, compact=False):
    status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all', '--', *MEDIA], cwd=root).decode().splitlines()
    changed = [line[3:] for line in status if (root / line[3:]).is_file()]
    patch_dir = root / 'brisk-dex-asset-patches'
    manifest_path = patch_dir / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    for start in range(0, len(changed), 24):
        entries = {}
        for path in changed[start:start + 24]:
            raw = (root / path).read_bytes()
            mime = 'image/gif' if path.endswith('.gif') else 'image/png'
            entries[path] = f'data:{mime};base64,' + base64.b64encode(raw).decode()
        payload = json.dumps(entries, separators=(',', ':')).encode()
        name = 'sync-' + hashlib.sha256(payload).hexdigest()[:16] + '.json'
        (patch_dir / name).write_text(json.dumps(base64.b64encode(gzip.compress(payload, mtime=0)).decode()))
        manifest.update({path: name for path in entries})
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':')))
    icons = {'icons': {}, 'shinyIcons': {}}
    for path in (root / 'brisk-dex-icons').glob('*.png'):
        stem = path.stem
        key = stem.removesuffix('_shiny')
        if key.isdecimal():
            icons['shinyIcons' if stem.endswith('_shiny') else 'icons'][key] = 'brisk-dex-icons/' + path.name
    (root / 'brisk-dex-icon-manifest.json').write_text(json.dumps(icons, separators=(',', ':')))
    if compact:
        tracked = set(subprocess.check_output(['git', 'ls-files', '--', *MEDIA], cwd=root).decode().splitlines())
        # Each compacted file has already been preserved byte-for-byte above.
        restore = [path for path in changed if path in tracked]
        if restore:
            subprocess.run(['git', 'restore', '--source=HEAD', '--worktree', '--', *restore], cwd=root, check=True)
        for path in changed:
            if path not in tracked:
                (root / path).unlink()
    print(f'Packed {len(changed)} updated graphic files; {len(icons["icons"])} icon references.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--compact-working-tree', action='store_true')
    args = parser.parse_args()
    package(Path(__file__).resolve().parents[1], args.compact_working_tree)
