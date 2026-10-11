#!/usr/bin/env python3
"""Render local blueprint JSON with the exact installed mods; never load or write a save."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import zipfile


def run(*args, cwd=None, timeout=300):
    # Own the process group so an aborted HTTP/agent request cannot orphan expensive work.
    process = subprocess.Popen(args, cwd=cwd, start_new_session=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def stop(signum, frame):
        os.killpg(process.pid, signal.SIGKILL)
        raise SystemExit(128 + signum)

    previous = signal.signal(signal.SIGTERM, stop)
    try:
        output, _ = process.communicate(timeout=timeout)
        if process.returncode:
            raise RuntimeError(output[-1500:])
    except BaseException:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise
    finally:
        signal.signal(signal.SIGTERM, previous)


def prepare(binary, mods, profile):
    version = json.loads((binary.parents[2] / 'data/base/info.json').read_text())['version']
    assets = Path.home() / '.local/share/facmandu-renderer/installations' / version / 'factorio'
    if not (assets / 'data/base/graphics').is_dir():
        raise RuntimeError(f'Install matching Factorio {version} sprite assets in the private renderer cache')
    if json.loads((assets / 'data/base/info.json').read_text())['version'] != version:
        raise RuntimeError('Renderer assets do not match the server version')
    destination = profile / 'build/vanilla/mods'
    destination.mkdir(parents=True, exist_ok=True)
    for entry in mods.iterdir():
        target = destination / entry.name
        if target.exists() or target.is_symlink():
            target.unlink()
        if entry.is_dir() or entry.suffix == '.zip':
            target.symlink_to(entry.resolve())
        elif entry.is_file():
            shutil.copyfile(entry, target)
    manifest = []
    for mod in json.loads((destination / 'mod-list.json').read_text())['mods']:
        if not mod.get('enabled'):
            continue
        name = mod['name']
        builtin = binary.parents[2] / 'data' / name / 'info.json'
        info = None
        if builtin.exists():
            info = json.loads(builtin.read_text())
        else:
            candidates = []
            for archive in mods.glob(name + '_*.zip'):
                with zipfile.ZipFile(archive) as contents:
                    names = [n for n in contents.namelist() if n.count('/') == 1 and n.endswith('/info.json')]
                    if names:
                        candidate = json.loads(contents.read(names[0]))
                        if candidate['name'] == name:
                            candidates.append(candidate)
            folder = mods / name / 'info.json'
            if folder.exists():
                candidates.append(json.loads(folder.read_text()))
            if len(candidates) != 1:
                raise RuntimeError(f'Expected one installed archive for {name}')
            info = candidates[0]
        manifest.append(dict(name=name, title=info.get('title', name), version=info['version'], builtin=builtin.exists(), category=info.get('category', ''), tags=[], downloads=0, owner=str(info.get('author', '')), updated=''))
    (profile / 'build/vanilla/manifest.json').write_text(json.dumps(dict(zips={}, mods=manifest)))
    folder = profile / 'profiles/vanilla'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'profile.json').write_text(json.dumps(dict(enabled=True, mods=[m['name'] for m in manifest])))
    # FBSR calls this profile "vanilla" internally; it contains this server's complete mod set.
    (profile / 'config.json').write_text(json.dumps(dict(
        discord=dict(enabled=False), webapi=dict(enabled=False, bind='127.0.0.1', port=0, local_storage=None),
        fbsr=dict(profiles='profiles', build='build', assets='assets'),
        factorio=dict(install=str(assets), executable=os.path.relpath(binary, assets)),
        modportal=dict(username=None, password=None))))
    data = profile / 'build/vanilla/data'
    data.mkdir(parents=True, exist_ok=True)
    ini = data / 'config.ini'
    ini.write_text(f'[path]\nread-data={binary.parents[2]}/data\nwrite-data={data}\n')
    dump = data / 'script-output/data-raw-dump.json'
    if not dump.exists():
        run('nice', '-n', '15', str(binary), '--config', str(ini), '--mod-directory', str(destination),
            '--threads', '2', '--dump-data')
    (data / 'script-output/version.txt').write_text(version)



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--icons', action='store_true')
    for name in ('binary', 'mods', 'profile', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--input', type=Path)
    args = parser.parse_args()
    if not args.icons and args.input is None:
        parser.error('--input is required for blueprint rendering')
    args.profile.mkdir(parents=True, exist_ok=True, mode=0o700)
    installation = Path(__file__).resolve().parent
    java = ['nice', '-n', '15', 'java', '-Xmx3g', '-XX:ActiveProcessorCount=2', '-Djava.awt.headless=true', '-cp',
            str(installation / 'classes') + ':' + str(installation / 'lib/*'), 'FacmanduRenderer']
    # Serialize all rendering jobs, including different servers, to cap total CPU and memory.
    with (Path.home() / '.local/share/facmandu-renderer/.render.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prepare(args.binary.resolve(), args.mods.resolve(), args.profile.resolve())
        if args.icons:
            dump = json.loads((args.profile / 'build/vanilla/data/script-output/data-raw-dump.json').read_text())
            hierarchy = json.loads((installation / 'type-hierarchy.json').read_text())
            def names(branch):
                result = set()
                for kind, children in branch.items():
                    result.update(dump.get(kind, {}))
                    result.update(names(children))
                return result
            requested = {kind: sorted(set(dump.get(kind, {})) | names(hierarchy[kind])) for kind in ('item', 'entity')}
            requested.update({kind: sorted(dump.get(kind, {})) for kind in ('recipe', 'fluid', 'technology')})
            icon_input = args.profile / 'icons.json'
            icon_input.write_text(json.dumps(requested))
            del dump
            run(*java, 'icons', str(icon_input.resolve()), str(args.output.resolve()), cwd=args.profile)
            return
        blueprint = json.loads(args.input.read_text())
        names = sorted({e['name'] for e in blueprint['entities']})
        tiles = sorted({e['name'] for e in blueprint.get('tiles', [])})
        icons = set()
        def collect(value):
            if isinstance(value, str):
                icons.add(value)
            elif isinstance(value, list):
                for item in value:
                    collect(item)
            elif isinstance(value, dict):
                for key, item in value.items():
                    if key not in ('label', 'description'):
                        collect(item)
        collect(blueprint)
        subset = hashlib.sha256(json.dumps([names, tiles, sorted(icons)]).encode()).hexdigest()
        layout = args.profile / 'layouts' / subset
        if not (layout / 'assets/vanilla.zip').exists():
            (layout / 'build/vanilla').mkdir(parents=True, exist_ok=True)
            (layout / 'profiles/vanilla').mkdir(parents=True, exist_ok=True)
            for entry in ('mods', 'manifest.json'):
                destination = layout / 'build/vanilla' / entry
                if not destination.exists():
                    destination.symlink_to((args.profile / 'build/vanilla' / entry).resolve())
            shutil.copyfile(args.profile / 'config.json', layout / 'config.json')
            shutil.copyfile(args.profile / 'profiles/vanilla/profile.json', layout / 'profiles/vanilla/profile.json')
            data = layout / 'build/vanilla/data/script-output'
            data.mkdir(parents=True, exist_ok=True)
            hierarchy = json.loads((installation / 'type-hierarchy.json').read_text())
            entity_types = set()
            def descendants(branch):
                for name, children in branch.items():
                    entity_types.add(name)
                    descendants(children)
            descendants(hierarchy['entity'])
            entity_types.add('entity')
            dump = json.loads((args.profile / 'build/vanilla/data/script-output/data-raw-dump.json').read_text())
            metadata = {'type', 'name', 'flags', 'subgroup', 'placeable_by', 'icon', 'icons', 'icon_size'}
            for kind, prototypes in dump.items():
                if kind in entity_types or kind == 'tile':
                    wanted = names if kind in entity_types else tiles
                    for name, prototype in list(prototypes.items()):
                        if name not in wanted:
                            prototypes[name] = {key: value for key, value in prototype.items() if key in metadata}
            # The renderer needs only recipes referenced by this view; production queries use the full native catalog.
            dump['recipe'] = {name: recipe for name, recipe in dump['recipe'].items() if name in icons}
            for unused in ('optimized-particle', 'optimized-decorative', 'animation', 'sprite'):
                dump.pop(unused, None)
            (data / 'data-raw-dump.json').write_text(json.dumps(dump, separators=(',', ':')))
            shutil.copyfile(args.profile / 'build/vanilla/data/script-output/version.txt', data / 'version.txt')
            del dump
            run(*java, 'build', str(args.input.resolve()), cwd=layout)
        run(*java, 'render', str(args.input.resolve()), str(args.output.resolve()), cwd=layout, timeout=90)


if __name__ == '__main__':
    try:
        main()
    except Exception as failure:
        print(str(failure), file=sys.stderr)
        sys.exit(1)
