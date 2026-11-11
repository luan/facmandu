#!/usr/bin/env python3
"""Run native gameplay and save/reload checks in a new disposable profile."""
import argparse
import json
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", type=Path, required=True)
parser.add_argument("--data", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--mods", type=Path, help="Optional installed modpack, read only")
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
stage = args.output.resolve()
stage.mkdir(parents=True, exist_ok=False)
mods = stage / "mods"
mods.mkdir()
(stage / "saves").mkdir()
if args.mods:
    for source in args.mods.resolve().iterdir():
        if source.suffix == ".zip" or source.is_dir():
            (mods / source.name).symlink_to(source)
        elif source.name in {"mod-list.json", "mod-settings.dat"}:
            shutil.copy2(source, mods / source.name)
    manifest = json.loads((mods / "mod-list.json").read_text())
else:
    manifest = {"mods": [{"name": name, "enabled": True} for name in
                         ["base", "space-age", "quality", "elevated-rails"]]}
for name, source in [
    ("platform-logistics", root / "factorio-mod/platform-logistics"),
    ("platform-logistics-qa", Path(__file__).resolve().parent),
]:
    shutil.copytree(source, mods / name, ignore=shutil.ignore_patterns("__pycache__", "run.py"))
    manifest["mods"] = [mod for mod in manifest["mods"] if mod["name"] != name]
    manifest["mods"].append({"name": name, "enabled": True})
(mods / "mod-list.json").write_text(json.dumps(manifest))
config = stage / "config.ini"
config.write_text(f"[path]\nread-data={args.data.resolve()}\nwrite-data={stage}\n")
settings = stage / "server-settings.json"
server_settings = json.loads((args.data / "server-settings.example.json").read_text())
server_settings.update({"name": "Platform logistics isolated QA", "visibility":
    {"public": False, "lan": False}, "auto_pause": False, "autosave_interval": 0})
settings.write_text(json.dumps(server_settings))
base = [str(args.binary.resolve()), "--config", str(config), "--mod-directory", str(mods)]
save = stage / "start.zip"

def run(arguments, name):
    with (stage / name).open("w") as log:
        subprocess.run(base + arguments, stdout=log, stderr=subprocess.STDOUT, check=True)

run(["--create", str(save)], "create.log")
result = stage / "script-output/platform-logistics-qa.json"
saved = stage / "saves/platform-logistics-qa-passed.zip"
with (stage / "server.log").open("w") as log:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen(base + ["--start-server", str(save), "--server-settings", str(settings),
                                      "--bind", f"127.0.0.1:{port}"], stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 300
        while not saved.exists():
            if process.poll() is not None:
                raise RuntimeError(f"Native QA server exited: {stage / 'server.log'}")
            if result.exists():
                try:
                    report = json.loads(result.read_text())
                except json.JSONDecodeError:
                    report = {}
                if "error" in report:
                    raise RuntimeError(report["error"])
            if time.monotonic() > deadline:
                raise RuntimeError(f"Native QA timed out: {stage / 'server.log'}")
            time.sleep(0.1)
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
        process.wait(timeout=60)
run(["--benchmark", str(saved), "--benchmark-ticks", "60", "--benchmark-runs", "1"], "reload.log")
report = json.loads(result.read_text())
assert report.get("passed") and report.get("save_reload"), report
print(json.dumps(report, indent=2))
