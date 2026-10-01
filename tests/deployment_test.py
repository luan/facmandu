import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).resolve().parents[1] / "infra/beast/deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
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
                return type("Result", (), {"stdout": revision + "\trefs/heads/main\n"})()

            with patch.object(deploy, "ROOT", root), patch.object(deploy, "SOURCE", previous), \
                 patch("pathlib.Path.home", return_value=home), patch.object(deploy, "run", side_effect=command), \
                 patch.object(deploy, "health", side_effect=RuntimeError("failed health")):
                deploy.switch(previous)
                with self.assertRaisesRegex(RuntimeError, "failed health"):
                    deploy.deploy(revision)
                self.assertEqual((root / "current").resolve(), previous)
                self.assertEqual(dropin.read_text(), original_configuration)
                self.assertFalse((root / "deployed.json").exists())
                self.assertEqual(deploy_calls.count(("systemctl", "--user", "restart", deploy.SERVICE)), 2)


if __name__ == "__main__":
    unittest.main()
