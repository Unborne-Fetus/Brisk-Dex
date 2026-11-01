#!/usr/bin/env python3
"""Three-way import of pinned Brisk content onto the pinned native engine.

Only Brisk's differences from expansion 1.17.0 are applied. Native-only platform
files stay intact. Overlapping source changes are merged rather than overwriting
native pointer/ABI guards. Unexpected conflicts stop the build.
"""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
CONFLICT = re.compile(r'^<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n', re.M | re.S)


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def tree(repo, ref):
    result = {}
    for entry in git(repo, 'ls-tree', '-rz', ref).split(b'\0'):
        if not entry:
            continue
        meta, name = entry.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        if kind == 'blob':
            result[name.decode()] = (mode, oid)
    return result


class Blobs:
    def __init__(self, repo):
        self.process = subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def get(self, oid):
        self.process.stdin.write((oid + '\n').encode())
        self.process.stdin.flush()
        header = self.process.stdout.readline().decode().split()
        if len(header) != 3 or header[1] != 'blob':
            raise RuntimeError('Missing source blob: ' + oid)
        size = int(header[2])
        parts = []
        while size:
            part = self.process.stdout.read(size)
            if not part:
                raise RuntimeError('Truncated source blob: ' + oid)
            parts.append(part)
            size -= len(part)
        if self.process.stdout.read(1) != b'\n':
            raise RuntimeError('Invalid blob framing')
        return b''.join(parts)

    def close(self):
        self.process.stdin.close()
        self.process.stdout.close()
        self.process.wait()


def resolve_conflicts(name, data):
    if name == 'README.md':
        return None  # use Brisk's complete README below
    strategies = {
        '.gitignore': 'both', 'data/scripts/debug.inc': 'both',
        'src/battle_setup.c': 'native', 'src/m4a.c': 'brisk',
        'src/save.c': 'brisk', 'src/battle_util.c': 'stab',
        'src/data/abilities.h': 'abilities',
        'src/data/pokemon/species_info/gen_7_families.h': 'native',
    }
    if name not in strategies:
        raise RuntimeError('Unreviewed Brisk/native conflict: ' + name)
    strategy = strategies[name]
    def choose(match):
        native, brisk = match.group(1), match.group(2)
        if strategy == 'both':
            return native + brisk
        if strategy == 'native':
            return native
        if strategy == 'abilities':
            return native + '    },\n\n' + brisk
        if strategy == 'stab':
            return '    if (ctx->moveType == TYPE_MYSTERY)\n        return UQ_4_12(1.0);\n' + brisk
        return brisk
    result, count = CONFLICT.subn(choose, data.decode())
    if not count or re.search(r'^(<<<<<<<|=======|>>>>>>>)', result, re.M):
        raise RuntimeError('Unresolved merge markers: ' + name)
    return result.encode()


def merge(name, native, base, brisk):
    with tempfile.TemporaryDirectory(prefix='brisk-merge-') as tmp:
        files = [Path(tmp) / name for name in ('native', 'base', 'brisk')]
        for file, content in zip(files, (native, base, brisk)):
            file.write_bytes(content)
        result = subprocess.run(['git', 'merge-file', '-p', '-L', 'native', '-L', 'base', '-L', 'brisk',
                                 *map(str, files)], capture_output=True)
        if result.returncode == 0:
            return result.stdout, False
        if result.returncode >= 128:
            raise RuntimeError('Cannot merge ' + name + ': ' + result.stderr.decode(errors='replace'))
        resolved = resolve_conflicts(name, result.stdout)
        return brisk if resolved is None else resolved, True


def prepare(repo, config):
    base, native, brisk = [tree(repo, config[k]) for k in ('expansion_base', 'native_commit', 'brisk_commit')]
    changes = sorted(name for name in base.keys() | brisk.keys() if base.get(name) != brisk.get(name))
    report = {'profile': 'brisk', **config, 'brisk_changed_files': len(changes),
              'direct_files': 0, 'merged_files': [], 'resolved_conflicts': []}
    blobs = Blobs(repo)
    try:
        # Reset the native-only inputs of the portability patch on repeated
        # builds. Brisk-modified inputs are rewritten by the merge below.
        patch = (ROOT / 'brisk-native-port.patch').read_text()
        patch_paths = re.findall(r'^diff --git a/([^\n]+) b/[^\n]+$', patch, re.M)
        for name in patch_paths:
            if name not in changes:
                item = native.get(name)
                if item is None:
                    raise RuntimeError('Port patch names an unknown native file: ' + name)
                path = repo / name
                content = blobs.get(item[1])
                if not path.exists() or path.read_bytes() != content:
                    path.write_bytes(content)
        for name in changes:
            rel = PurePosixPath(name)
            if rel.is_absolute() or '..' in rel.parts or rel.parts[0] == '.git':
                raise RuntimeError('Unsafe source path: ' + name)
            dest = repo.joinpath(*rel.parts)
            original, host, custom = base.get(name), native.get(name), brisk.get(name)
            if custom is None:
                if host != original:
                    raise RuntimeError('Brisk deleted a native-modified file: ' + name)
                if dest.is_file() or dest.is_symlink():
                    dest.unlink()
                continue
            mode, oid = custom
            custom_bytes = blobs.get(oid)
            if host == original or host == custom:
                content = custom_bytes
                report['direct_files'] += 1
            elif host is None or original is None:
                raise RuntimeError('Unreviewed add/delete source conflict: ' + name)
            else:
                content, conflict = merge(name, blobs.get(host[1]), blobs.get(original[1]), custom_bytes)
                report['merged_files'].append(name)
                if conflict:
                    report['resolved_conflicts'].append(name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if mode == '120000':
                target = content.decode()
                if os.path.commonpath([str((dest.parent / target).resolve()), str(repo.resolve())]) != str(repo.resolve()):
                    raise RuntimeError('Source symlink escapes checkout: ' + name)
                if dest.is_symlink() and os.readlink(dest) == target:
                    continue
                if dest.exists() or dest.is_symlink():
                    dest.unlink()
                dest.symlink_to(target)
            elif mode in ('100644', '100755'):
                if dest.is_symlink():
                    dest.unlink()
                if not dest.exists() or dest.read_bytes() != content:
                    dest.write_bytes(content)
                dest.chmod(0o755 if mode == '100755' else 0o644)
            else:
                raise RuntimeError('Unsupported source mode: ' + mode)
    finally:
        blobs.close()
    output = repo / 'BRISK_NATIVE_SOURCE.json'
    text = json.dumps(report, indent=2) + '\n'
    if not output.exists() or output.read_text() != text:
        output.write_text(text)
    print('Imported %d Brisk files; merged %d overlapping files; resolved %d reviewed conflicts' %
          (len(changes), len(report['merged_files']), len(report['resolved_conflicts'])))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('checkout', type=Path)
    args = parser.parse_args()
    prepare(args.checkout.resolve(), json.loads((ROOT / 'brisk-native-source.json').read_text()))
