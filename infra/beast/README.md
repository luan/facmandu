# Automatic deployment to beast

`facmandu-deploy.timer` checks public `luan/facmandu` main every five minutes. It
uses no GitHub token, SSH deploy key, webhook secret, or self-hosted runner. Only
the latest successful push run of `quality.yml` for the exact main SHA qualifies.
A failed or unfinished rerun blocks deployment. Pull request checks never deploy.

The updater uses a user-level file lock and systemd oneshot service, so overlapping
checks cannot deploy twice. It installs frozen dependencies and builds without
production environment variables in an isolated release directory. Preparation
does not alter the running app or game processes.

After preparation it atomically switches the release symlink and restarts the
existing `facmandu-dev.service`. The health endpoint must report the exact SHA and
working database access; login and private Vite source boundaries are checked too.
Failures restore the previous symlink and service drop-in, then restart the prior
app. The script never restarts Factorio or changes its saves, mods, or settings.

Runtime settings stay in `/home/luan/.local/share/facmandu-app/.env`; the database
replica and mod cache already use absolute paths outside source. Existing assistant
state remains in `/home/luan/src/facmandu/.data/agent`. This path is explicitly set
in the release drop-in so changing the app's working directory cannot lose chats.
Do not remove the original checkout or these private directories.

## Install or update

On beast, using the existing `luan` account:

```sh
mkdir -p ~/.local/share/facmandu-deploy ~/.config/systemd/user
chmod 700 ~/.local/share/facmandu-deploy
install -m 700 infra/beast/deploy.py ~/.local/share/facmandu-deploy/deploy.py
install -m 644 infra/beast/facmandu-deploy.service infra/beast/facmandu-deploy.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now facmandu-deploy.timer
systemctl --user start facmandu-deploy.service
```

Python 3.12 or newer, Git, Node, and Bun 1.4.2 must already be installed. The
existing dev service and Cloudflare Tunnel remain the only app listener and public
route. No second app process runs against the replica. Before the first cutover,
save private backups of the environment, a consistent SQLite replica backup, and
the original source; retain the existing game data. Never build in the live source
directory while Vite is running.

Inspect without exposing credentials:

```sh
systemctl --user status facmandu-deploy.timer facmandu-deploy.service
journalctl --user -u facmandu-deploy.service -n 40
curl -fsS http://127.0.0.1:5173/api/health
```

## Roll back and pause

```sh
systemctl --user stop facmandu-deploy.timer
python3 ~/.local/share/facmandu-deploy/deploy.py --rollback
```

The previous release/source and service configuration are retained. Source rollback
preserves current database writes and game data; it does not reverse schema
migrations. Keep migrations additive and test old-code compatibility before any
future destructive schema change. The first rollback points at the original beast
checkout; subsequent rollbacks point at the previous immutable release. Verify
login and `/api/health` after rollback (the original checkout predates that endpoint).
Restart the timer only when the desired main revision is safe to deploy again.

Update the installed updater script and timer explicitly when deployment behavior
changes; application releases do not silently replace the updater itself.
