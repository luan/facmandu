#!/usr/bin/env python3
"""Deploy only successful main CI revisions, with private state kept outside releases."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

REPOSITORY = "https://github.com/luan/facmandu.git"
API = "https://api.github.com/repos/luan/facmandu"
ROOT = Path.home() / ".local/share/facmandu-deploy"
SOURCE = Path.home() / "src/facmandu"
APP_STATE = Path.home() / ".local/share/facmandu-app"
SERVICE = "facmandu-dev.service"
SHA = re.compile(r"[0-9a-f]{40}\Z")


def run(*args, cwd=None, capture=False, env=None):
    return subprocess.run(args, cwd=cwd, env=env, check=True,
                          text=True, stdout=subprocess.PIPE if capture else None)


def fetch_json(url):
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                   "User-Agent": "facmandu-beast-deploy"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def ci_passed(revision):
    result = fetch_json(f"{API}/actions/workflows/quality.yml/runs?branch=main&event=push&head_sha={revision}&per_page=10")
    # A failed rerun must supersede an earlier passing attempt for this revision.
    runs = sorted((item for item in result["workflow_runs"]
                   if item["head_sha"] == revision and item["event"] == "push"
                   and item["head_branch"] == "main"),
                  key=lambda item: (item["id"], item["run_attempt"]), reverse=True)
    return bool(runs and runs[0]["status"] == "completed" and runs[0]["conclusion"] == "success")


def switch(target):
    temporary = ROOT / ".current-next"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    temporary.replace(ROOT / "current")


def health(revision):
    # The exact running revision and DB connectivity must agree after restart.
    for _ in range(45):
        try:
            result = fetch_json("http://127.0.0.1:5173/api/health")
            if result == {"status": "ok", "revision": revision}:
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError("Running revision/database health did not become ready")
    for path in ("/src/lib/server/db/index.ts", "/@fs" + str(APP_STATE / ".env"),
                 "/.env", "/__open-in-editor"):
        try:
            urllib.request.urlopen("http://127.0.0.1:5173" + path, timeout=10)
        except urllib.error.HTTPError as cause:
            cause.close()
            if cause.code == 403:
                continue
        raise RuntimeError("Private source boundary failed")
    # A cold Vite release compiles the page/CSS after the DB endpoint is ready.
    # Retry transport timeouts, but never accept a broken page or boundary check.
    for attempt in range(6):
        try:
            with urllib.request.urlopen("http://127.0.0.1:5173/login", timeout=10) as response:
                if response.status != 200 or b"Facmandu" not in response.read():
                    raise RuntimeError("Login page did not load")
            return
        except urllib.error.HTTPError as cause:
            cause.close()
            raise
        except OSError:
            if attempt == 5:
                raise
            time.sleep(1)


def install_dropin(revision):
    path = Path.home() / ".config/systemd/user/facmandu-dev.service.d/50-release.conf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("[Service]\nWorkingDirectory=" + str(ROOT / "current") + "\n"
                    "ExecStart=\nExecStart=/usr/bin/bun --no-env-file --env-file=" + str(APP_STATE / ".env") + " run dev\n"
                    "Environment=FACMANDU_REVISION=" + revision + "\n"
                    "Environment=FACMANDU_DEV_ENV_DIR=" + str(APP_STATE) + "\n"
                    "Environment=FACMANDU_AGENT_DATA=" + str(SOURCE / ".data/agent") + "\n")
    run("systemctl", "--user", "daemon-reload")


def deploy(revision):
    releases = ROOT / "releases"
    releases.mkdir(exist_ok=True)
    destination = releases / revision
    if not (destination / ".ready").exists():
        # Failed preparations are isolated and can be safely retried.
        temporary = Path(tempfile.mkdtemp(prefix=".prepare-", dir=releases))
        try:
            mirror = ROOT / "repository"
            if not mirror.exists():
                run("git", "init", "--bare", str(mirror))
            run("git", "--git-dir=" + str(mirror), "fetch", "--depth=1", REPOSITORY, revision)
            archive = temporary / "source.tar"
            run("git", "--git-dir=" + str(mirror), "archive", "--output=" + str(archive), revision)
            with tarfile.open(archive) as source:
                source.extractall(temporary, filter="data")
            archive.unlink()
            # Never load production .env or database credentials into install/build.
            environment = {"HOME": str(Path.home()), "PATH": os.environ["PATH"]}
            if run("bun", "--version", capture=True).stdout.strip() != "1.4.2":
                raise RuntimeError("Bun 1.4.2 is required")
            run("bun", "install", "--frozen-lockfile", cwd=temporary, env=environment)
            run("bun", "run", "build", cwd=temporary, env=environment)
            (temporary / ".ready").write_text(revision + "\n")
            if destination.exists():
                raise RuntimeError("Unexpected existing incomplete release; inspect it manually")
            temporary.rename(destination)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    dropin = Path.home() / ".config/systemd/user/facmandu-dev.service.d/50-release.conf"
    current_main = run("git", "ls-remote", REPOSITORY, "refs/heads/main", capture=True).stdout.split()[0]
    if current_main != revision:
        print("Main advanced during preparation; waiting for its quality checks")
        return
    previous_dropin = dropin.read_bytes() if dropin.exists() else None
    current = ROOT / "current"
    previous = current.resolve() if current.is_symlink() else SOURCE
    if not previous.exists():
        raise RuntimeError("Rollback source is missing")
    # Source rollback preserves additive schema and every current save/cache/chat.
    (ROOT / "previous.json").write_text(json.dumps({"path": str(previous),
          "dropin": previous_dropin.decode() if previous_dropin else None}))
    switch(destination)
    try:
        install_dropin(revision)
        run("systemctl", "--user", "restart", SERVICE)
        health(revision)
    except BaseException:
        switch(previous)
        if previous_dropin is None:
            dropin.unlink(missing_ok=True)
        else:
            dropin.write_bytes(previous_dropin)
        run("systemctl", "--user", "daemon-reload")
        run("systemctl", "--user", "restart", SERVICE)
        raise
    (ROOT / "deployed.json").write_text(json.dumps({"revision": revision, "time": time.time()}))
    print("Deployed and verified " + revision)


def rollback():
    state = json.loads((ROOT / "previous.json").read_text())
    previous = Path(state["path"])
    if not previous.exists():
        raise RuntimeError("Rollback source is missing")
    switch(previous)
    dropin = Path.home() / ".config/systemd/user/facmandu-dev.service.d/50-release.conf"
    if state["dropin"] is None:
        dropin.unlink(missing_ok=True)
    else:
        dropin.write_text(state["dropin"])
    run("systemctl", "--user", "daemon-reload")
    run("systemctl", "--user", "restart", SERVICE)
    (ROOT / "deployed.json").unlink(missing_ok=True)
    print("Restored previous source. Stop facmandu-deploy.timer to keep it pinned.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / "deploy.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if args.rollback:
            rollback()
            return
        revision = run("git", "ls-remote", REPOSITORY, "refs/heads/main", capture=True).stdout.split()[0]
        if not SHA.fullmatch(revision):
            raise RuntimeError("Invalid main revision")
        if (ROOT / "deployed.json").exists() and json.loads((ROOT / "deployed.json").read_text())["revision"] == revision:
            return
        if not ci_passed(revision):
            print("Waiting for successful main quality checks")
            return
        deploy(revision)


if __name__ == "__main__":
    main()
