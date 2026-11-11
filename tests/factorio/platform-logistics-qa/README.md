# Native platform logistics QA

Run from the repository root with an installed Factorio 2.1 executable and its data directory:

```sh
python3 tests/factorio/platform-logistics-qa/run.py \
  --binary /path/to/factorio \
  --data /path/to/factorio/data \
  --output .data/platform-logistics-test
```

The output directory must not exist. Add `--mods /path/to/installed/mods` to repeat the same gameplay checks with an installed modpack. Archives are read through symlinks; configuration and settings are copied. The test never edits the installed profile or opens a public game.

The fixture runs real robot deliveries, qualities, automatic fleet growth and retirement, blackout and recovery, platform expansion, foundation removal, force isolation, red/green reader circuits with item qualities and robot counts, blueprint/copy settings and live output updates, conservation of player-owned robots with a full hub, platform deletion, and a server save/reload. It also checks that planets and construction do not gain robots. Logs, the copied profile, saved world, and JSON results remain in the chosen output directory.

This fixture grants test materials and technologies and changes game speed. Never enable it in a real save.
