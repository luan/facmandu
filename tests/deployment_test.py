import importlib.util
import io
import sqlite3
import tarfile
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).resolve().parents[1] / "infra/beast/deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_open_tabs_retain_old_chunks_without_overwriting_current_assets_or_copying_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = Path(directory) / 'previous'
            destination = Path(directory) / 'next'
            old = previous / 'build/client/_app/immutable/nodes'
            new = destination / 'static/_app/immutable/nodes'
            old.mkdir(parents=True)
            new.mkdir(parents=True)
            (old / 'old.hash.js').write_text('old chunk')
            (old / 'old.hash.js.gz').write_text('old compressed chunk')
            (old / 'shared.hash.js').write_text('previous')
            (new / 'shared.hash.js').write_text('current')
            (previous / '.env').write_text('private')
            (old / 'private.js').symlink_to(previous / '.env')
            deploy.retain_client_assets(previous, destination)
            self.assertEqual((new / 'old.hash.js').read_text(), 'old chunk')
            self.assertEqual((new / 'shared.hash.js').read_text(), 'current')
            self.assertFalse((destination / '.env').exists())
            self.assertFalse((new / 'private.js').exists())
            self.assertFalse((new / 'old.hash.js.gz').exists())
            deploy.retain_client_assets(previous, destination)
            deploy.retain_client_assets(Path(directory) / 'missing', destination)

    def test_old_chunks_are_included_before_the_new_release_build(self):
        revision = 'a' * 40
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            root = home / 'state'
            root.mkdir()
            previous = home / 'previous'
            old = previous / 'build/client/_app/immutable/nodes'
            old.mkdir(parents=True)
            (old / 'old.hash.js').write_text('old chunk')
            (root / 'current').symlink_to(previous)
            bun = str(root / 'bun' / deploy.BUN_VERSION / 'bun')
            observed = []

            def command(*args, **kwargs):
                if args[:2] == ('git', 'ls-remote'):
                    return type('Result', (), {'stdout': revision + '\trefs/heads/main\n'})()
                if args[:2] == (bun, '--version'):
                    return type('Result', (), {'stdout': deploy.BUN_VERSION + '\n'})()
                for arg in args:
                    if arg.startswith('--output='):
                        with tarfile.open(arg.removeprefix('--output='), 'w'):
                            pass
                if args == (bun, 'run', 'build'):
                    observed.append((kwargs['cwd'] / 'static/_app/immutable/nodes/old.hash.js').read_text())
                    self.assertEqual(kwargs['env']['PATH'].split(':')[0], str(Path(bun).parent))
                return type('Result', (), {'stdout': ''})()

            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'SOURCE', previous), \
                 patch('pathlib.Path.home', return_value=home), patch.object(deploy, 'run', side_effect=command), \
                 patch.object(deploy, 'install_dropin'), patch.object(deploy, 'health'), \
                 patch.object(deploy, 'assistant_busy', return_value=False), \
                 patch.object(deploy, 'renderer_busy', return_value=False):
                deploy.deploy(revision)
            self.assertEqual(observed, ['old chunk'])

    def test_cold_login_retries_timeout_but_rejects_invalid_page(self):
        revision = "a" * 40
        calls = []

        def request(url, timeout):
            calls.append(url)
            if url.endswith("/login"):
                if calls.count(url) == 1:
                    raise TimeoutError("cold page compilation")
                response = io.BytesIO(b"Facmandu")
                response.status = 200
                return response
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, None)

        with patch.object(deploy, "fetch_json", return_value={"status": "ok", "revision": revision}), \
             patch.object(deploy.urllib.request, "urlopen", side_effect=request), \
             patch.object(deploy.time, "sleep"):
            deploy.health(revision)
        self.assertEqual(calls.count("http://127.0.0.1:5173/login"), 2)
        for failure in (urllib.error.HTTPError("/login", 500, "Broken page", {}, None),
                        TimeoutError("still unavailable")):
            def broken(url, timeout):
                if url.endswith("/login"):
                    raise failure
                raise urllib.error.HTTPError(url, 403, "Forbidden", {}, None)
            with patch.object(deploy, "fetch_json", return_value={"status": "ok", "revision": revision}), \
                 patch.object(deploy.urllib.request, "urlopen", side_effect=broken), \
                 patch.object(deploy.time, "sleep"), self.assertRaises(type(failure)):
                deploy.health(revision)

    def test_quality_gate_rejects_wrong_revision_event_and_failed_rerun(self):
        revision = "a" * 40
        passing = dict(head_sha=revision, event="push", head_branch="main", id=10,
                       run_attempt=1, status="completed", conclusion="success")
        with patch.object(deploy, "fetch_json", return_value={"workflow_runs": [passing]}):
            self.assertTrue(deploy.ci_passed(revision))
        for change in (dict(head_sha="b" * 40), dict(event="pull_request"),
                       dict(head_branch="other"), dict(status="in_progress"),
                       dict(run_attempt=2, conclusion="failure")):
            with patch.object(deploy, "fetch_json", return_value={"workflow_runs": [{**passing, **change}]}):
                self.assertFalse(deploy.ci_passed(revision))
        with patch.object(deploy, "fetch_json", return_value={"workflow_runs": [passing, {**passing, "run_attempt": 2, "conclusion": "failure"}]}):
            self.assertFalse(deploy.ci_passed(revision))

    def test_release_runs_the_built_server_on_the_existing_private_listener(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            root = home / 'state'
            with patch('pathlib.Path.home', return_value=home), patch.object(deploy, 'ROOT', root), patch.object(deploy, 'run'):
                deploy.install_dropin('a' * 40)
            text = (home / '.config/systemd/user/facmandu-dev.service.d/50-release.conf').read_text()
            self.assertIn('ExecStart=' + str(root / 'bun' / deploy.BUN_VERSION / 'bun') + ' ', text)
            self.assertIn(' run start\n', text)
            self.assertIn('Environment=HOST=127.0.0.1\n', text)
            self.assertIn('Environment=PORT=5173\n', text)
            self.assertIn('Environment=ORIGIN=https://factorio.luan.sh\n', text)
            self.assertIn('Environment=BODY_SIZE_LIMIT=105M\n', text)
            self.assertIn('Environment=FACMANDU_AGENT_DATA=', text)
            self.assertNotIn(' run dev\n', text)

    def test_deployment_waits_for_web_and_in_game_assistant_work(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory).resolve()
            (state / '.data').mkdir()
            database = state / '.data/replica.db'
            with patch.object(deploy, 'APP_STATE', state):
                self.assertFalse(deploy.assistant_busy())
                with sqlite3.connect(database) as connection:
                    for table in ('server_assistant_turn', 'assistant_turn'):
                        connection.execute(f'CREATE TABLE {table} (state TEXT)')
                    connection.commit()
                    self.assertFalse(deploy.assistant_busy())
                    for table in ('server_assistant_turn', 'assistant_turn'):
                        connection.execute(f"INSERT INTO {table} VALUES ('running')")
                        connection.commit()
                        self.assertTrue(deploy.assistant_busy())
                        connection.execute(f"UPDATE {table} SET state='done'")
                        connection.commit()
                        self.assertFalse(deploy.assistant_busy())
                    connection.execute('DROP TABLE assistant_turn')
                    connection.commit()
                    self.assertTrue(deploy.assistant_busy())

    def test_deployment_waits_for_preview_work_after_the_assistant_settles(self):
        with tempfile.TemporaryDirectory() as directory:
            processes = Path(directory)
            renderer = str(Path.home() / '.local/share/facmandu-renderer/current/render.py').encode()
            self.assertFalse(deploy.renderer_busy(processes))
            process = processes / '123'
            process.mkdir()
            command = process / 'cmdline'
            command.write_bytes(b'python3\0' + renderer + b'\0--input\0snapshot.json\0')
            self.assertTrue(deploy.renderer_busy(processes))
            command.write_bytes(b'python3\0unrelated-script.py\0')
            self.assertFalse(deploy.renderer_busy(processes))
            command.write_bytes(b'python3\0' + renderer + b'.unrelated\0')
            self.assertFalse(deploy.renderer_busy(processes))

    def test_failed_health_restores_previous_source_and_service_configuration(self):
        revision = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            root = home / "state"
            root.mkdir()
            previous = home / "original"
            previous.mkdir()
            release = root / "releases" / revision
            release.mkdir(parents=True)
            (release / ".ready").write_text(revision)
            dropin = home / ".config/systemd/user/facmandu-dev.service.d/50-release.conf"
            dropin.parent.mkdir(parents=True)
            original_configuration = "[Service]\nWorkingDirectory=" + str(previous) + "\n"
            dropin.write_text(original_configuration)
            deploy_calls = []

            def command(*args, **kwargs):
                deploy_calls.append(args)
                if args[-1] == '--version':
                    return type("Result", (), {"stdout": deploy.BUN_VERSION + "\n"})()
                return type("Result", (), {"stdout": revision + "\trefs/heads/main\n"})()

            with patch.object(deploy, "ROOT", root), patch.object(deploy, "SOURCE", previous), \
                 patch("pathlib.Path.home", return_value=home), patch.object(deploy, "run", side_effect=command), \
                 patch.object(deploy, "health", side_effect=RuntimeError("failed health")), \
                 patch.object(deploy, "assistant_busy", return_value=False), \
                 patch.object(deploy, "renderer_busy", return_value=False):
                deploy.switch(previous)
                with self.assertRaisesRegex(RuntimeError, "failed health"):
                    deploy.deploy(revision)
                self.assertEqual((root / "current").resolve(), previous)
                self.assertEqual(dropin.read_text(), original_configuration)
                self.assertFalse((root / "deployed.json").exists())
                self.assertEqual(deploy_calls.count(("systemctl", "--user", "restart", deploy.SERVICE)), 2)

    def test_wrong_bun_version_cannot_switch_a_prepared_release(self):
        revision = 'a' * 40
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            root = home / 'state'
            previous = home / 'previous'
            previous.mkdir()
            release = root / 'releases' / revision
            release.mkdir(parents=True)
            (release / '.ready').write_text(revision)
            (root / 'current').symlink_to(previous)
            result = type('Result', (), {'stdout': '1.4.2\n'})()
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'run', return_value=result) as command:
                with self.assertRaisesRegex(RuntimeError, 'Bun 1.4.4 is required'):
                    deploy.deploy(revision)
            self.assertEqual((root / 'current').resolve(), previous)
            self.assertEqual(command.call_count, 1)


if __name__ == "__main__":
    unittest.main()
