# Live development on beast

Open **https://factorio.luan.sh**. It uses Facmandu's existing login and current database. Source edits in `/home/luan/src/facmandu` become live through Vite HMR without a build or deployment. The Cloudflare tunnel routes the public hostname to Vite on `127.0.0.1:5173`; HMR uses HTTPS port 443. No SSH forwarding is needed.

The enabled [user service](facmandu-dev.service) owns Vite. It loads `/home/luan/.local/share/facmandu-app/.env`, including the absolute database replica and cache paths. TypeSafe keys belong to user accounts. The service excludes inherited global TypeSafe keys. Existing accounts, passwords, sessions, and cached rankings are preserved. The old `facmandu.service` is stopped and disabled. The temporary `factorio-dev.luan.sh` DNS, tunnel route, and Access application have been removed.

Edit directly on beast, or sync only the files you own from the Mac. Keep `.env`, databases, caches, `.git`, dependencies, and generated output out of source sync. `bun run check` can run alongside Vite without rewriting its generated route root or forcing a browser reload. Run production builds in a separate checkout or while Vite is stopped.

Vite denies HTTP requests for server source, generated server output, private environment modules, credentials, and debug endpoints. New server code belongs in the existing server-only locations; update the boundary rules if a new location is introduced. Explicit server, mod, save, and console actions in the public UI manage Factorio directly on beast.

## Service and rollback

```sh
systemctl --user status facmandu-dev.service
journalctl --user -u facmandu-dev.service -f
systemctl --user restart facmandu-dev.service
systemctl --user stop facmandu-dev.service
```

The native-manager cutover backup is at `/home/luan/.local/share/facmandu-cutover/20260926T123120-native`. It contains credentials and stays on beast. The previous built app predates native instance management; it is not a compatible rollback. Preserve current saves and database writes when restoring source changes. Never run both app services against the same replica.

## Remote Codex thread

The parent can send a task from the Mac:

```sh
ssh beast 'cd /home/luan/src/facmandu && codex exec resume 01a0de6c-8761-7e10-a8da-0dd7e9206692 "Next task..."'
```

On beast, Luan can resume the same thread interactively:

```sh
cd /home/luan/src/facmandu
codex resume 01a0de6c-8761-7e10-a8da-0dd7e9206692
```
