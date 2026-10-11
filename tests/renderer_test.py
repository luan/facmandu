import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    'renderer', Path(__file__).resolve().parents[1] / 'infra/beast/renderer/render.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RendererTests(unittest.TestCase):
    def test_profiles_select_newest_numeric_version_or_exact_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            assets = home / '.local/share/facmandu-renderer/installations/2.1.21/factorio/data/base'
            (assets / 'graphics').mkdir(parents=True)
            (assets / 'info.json').write_text(json.dumps({'version': '2.1.21'}))
            binary = home / 'factorio/bin/x64/factorio'
            base = binary.parents[2] / 'data/base'
            base.mkdir(parents=True)
            (base / 'info.json').write_text(json.dumps({'version': '2.1.21'}))
            mods = home / 'mods'
            mods.mkdir()
            for version in ('3.2.1', '4.0.4', '4.0.10'):
                with zipfile.ZipFile(mods / f'entourage_{version}.zip', 'w') as archive:
                    archive.writestr(f'entourage_{version}/info.json', json.dumps({
                        'name': 'entourage', 'version': version, 'title': 'Archived'}))
            unpacked = mods / 'entourage'
            unpacked.mkdir()
            (unpacked / 'info.json').write_text(json.dumps({
                'name': 'entourage', 'version': '4.0.10', 'title': 'Unpacked'}))

            for pin, version, title in ((None, '4.0.10', 'Unpacked'),
                                        ('4.0.4', '4.0.4', 'Archived'),
                                        ('9.0.0', None, None)):
                with self.subTest(pin=pin):
                    mod = {'name': 'entourage', 'enabled': True}
                    if pin:
                        mod['version'] = pin
                    (mods / 'mod-list.json').write_text(json.dumps({'mods': [mod]}))
                    profile = home / ('profile-' + (pin or 'latest'))
                    dump = profile / 'build/vanilla/data/script-output/data-raw-dump.json'
                    dump.parent.mkdir(parents=True)
                    dump.write_text('{}')
                    with patch('pathlib.Path.home', return_value=home), patch.object(renderer, 'run'):
                        if version is None:
                            with self.assertRaisesRegex(RuntimeError, 'No installed selected version'):
                                renderer.prepare(binary, mods, profile)
                        else:
                            renderer.prepare(binary, mods, profile)
                            manifest = json.loads((profile / 'build/vanilla/manifest.json').read_text())
                            self.assertEqual(manifest['mods'][0]['version'], version)
                            self.assertEqual(manifest['mods'][0]['title'], title)
            self.assertTrue((mods / 'entourage_3.2.1.zip').exists())


if __name__ == '__main__':
    unittest.main()
