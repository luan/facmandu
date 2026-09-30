# Facmandu

A Factorio server manager with a shared mod library. Manage multiple instances, choose a list for each server, review the exact changes, and apply them while the game is stopped.

## Workflows

- **Servers** is the home screen. Each server has its own Console, Mods, Saves, Settings, and Access workspace. Instances, selected lists, jobs, logs, and command history stay scoped to that server. Installed versions and settings load independently of remote release checks.
- **Mod library** contains reusable lists with an explicit Factorio branch. Imports retain compatible versions. Mod details let you choose a preferred release. Background repair fills missing metadata, resolves required dependencies, and reports conflicts that need a choice. Locked mods and explicit bundled-mod choices are preserved.
- **Review and apply** compares exact installed versions with the selected list. A changed review must be reviewed again. Applying requires a stopped server; archives outside the list are disabled, not deleted. Unpacked development mods cannot be overwritten. Interrupted jobs are reported after restart and are never silently replayed.
- **Console** combines live logs and RCON with command completion, keyboard history, syntax highlighting, level/source filters, search, pause/follow, copy, and download. Rendering and retained output are bounded.
- **Activity** follows repairs, exports, downloads, shutdown, and mod deployment across SPA navigation. Ordinary forms submit without document reloads.
- **Recommendations** start with compatible optional companions and reject known conflicts. Optional TypeSafe curation scores only these verified candidates; AI never decides dependency correctness.

## Run locally

Use Bun **1.4.2**:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

The default `DATABASE_URL=file:local.db` creates a local SQLite database on first request. Existing databases receive additive migrations. Register an account, then add your account ID to `FACMANDU_OPERATOR_USER_IDS` to enable server management. Read the ID with `SELECT id FROM user WHERE username = 'your-username'`.

For a remote database, set `TURSO_CONNECTION_URL=libsql://…` and `TURSO_AUTH_TOKEN`. Turso takes precedence over `DATABASE_URL`. Set `ORIGIN` to the public HTTPS origin in production. Keep environment files and database backups private: they contain account and server credentials.

## Manage servers

Server management runs on Linux with systemd user services. Facmandu owns each Factorio process, save directory, mod directory, settings file, and installation. Each instance gets available game and loopback-only RCON ports automatically; Advanced permits explicit choices. There is no companion manager.

Assistant prototype icons use Factorio's native icon export for the selected version and enabled mods. The host needs `xvfb-run` and a full Factorio installation with graphics data; headless-only downloads cannot export icons and show the text fallback.

Create instances through **Servers → New server**. Set `FACMANDU_SERVER_DIRECTORY` to choose the data root; the default is `~/.local/share/facmandu/servers`. Select a Factorio version, create or upload a save, and start it. systemd keeps game processes independent of app reloads. Shutdown sends SIGINT and waits for Factorio to save.

**Saves → Create save** configures the world before generation: native presets, seed, map dimensions, resource frequency/size/richness, terrain, peaceful mode, evolution, expansion, pollution, and research cost. Options use the selected installation and enabled mods. Generate a native map preview before creating; changing settings marks the preview stale. Generation uses an isolated profile so the current server can keep running. New archives are published only after generation succeeds and never overwrite existing saves.

`FACMANDU_OPERATOR_USER_IDS` is a comma-separated allowlist of Facmandu account IDs. Ordinary users can still use shared mod lists. Server settings apply on the next start. The Settings workspace shows each mod’s settings, defaults, allowed choices and ranges. While stopped, edits patch Factorio’s native `mods/mod-settings.dat`: startup settings apply on restart and runtime defaults apply to new saves. Runtime global settings can also be changed through RCON in the owning mod’s context for the loaded save. Running instances show effective values; player defaults are read-only because some mods require a player context when handling changes. Player access changes are sent over RCON when running and saved on disk. Downloads use Factorio's official headless distribution; mod downloads need a Factorio username and service token unless the archive is already cached.

## Cache and performance

| Data | Storage and refresh |
| --- | --- |
| Mod metadata and release history | SQLite/Turso; reused indefinitely, with daily rechecks for unresolved releases or an explicit refresh |
| Mod search and bookmarks | Durable cache, 15 minutes, isolated by Factorio credentials |
| Available Factorio releases | Durable cache, 24 hours |
| Missing portal entries | Cached 15 minutes |
| Remote failures | Retry cooldown; valid stale data stays usable |
| Mod archives | Disk, validated against the portal SHA-1; atomic downloads |
| Exports | Disk, keyed by exact resolved contents; concurrent requests share work |
| Server status / local views | Local process state and files; no remote manager calls |
| Map generation options / previews | Instance disk; keyed by selected version, mods, startup settings and preview parameters |

Set `FACMANDU_CACHE_DIR` to persistent storage. Its `mods/` and `exports/` directories survive restarts. Downloads are never treated as complete before validation. Retain this directory to avoid repeated downloads; remove only when no download/export job is running.

If database writes fail, up to 128 pending cache entries stay in memory and retry persistence on later reads. Valid results and portal retry cooldowns remain usable during that outage. Completed server jobs also retain their outcome for retry; reconnecting never replays their mutations.

For a remote Turso database, `FACMANDU_REPLICA_PATH` enables a durable local read replica. Writes still go to Turso and reads see this process's writes; external changes sync every 60 seconds. Native database access runs in a worker thread so network sync and writes cannot block the web event loop. Requests wait behind active transactions without preventing their commit or rollback; local databases use WAL for concurrent readers. Facmandu currently runs as **one app process**: mutation locks, live activity, and log fan-out are in-process. Add shared leases and event delivery before horizontally scaling.

Cold metadata may require portal requests. Missing credentials, unavailable releases, and dependency conflicts are reported explicitly. Automatic repair keeps compatible versions, reports any release changes needed for compatibility, and never deletes user mods. **Update mods** explicitly selects newer compatible releases and resolves their dependencies; individual rows also offer an update action. A preferred release may change if another enabled mod requires a different version; unresolved choices remain visible for review.

Add a TypeSafe API key in Account settings to enable automatic recommendation ranking. Every list uses its creator’s key, including requests from collaborators. There is no global key fallback. Results are validated and cached by candidate and list contents; list changes invalidate stale scores. No key is needed for deterministic recommendations.

## Accounts and assistant

Account creation requires a single-use invitation from Administration. Invitations expire after seven days and can be revoked. Administrators can grant or remove administrator roles; the last administrator cannot be removed. The existing `luan` account is promoted once by migration. On a fresh installation, provision the first administrator directly in the database; public registration never bootstraps an administrator.

Connect Codex, Muse (Meta), or GitHub Copilot in Account settings using the provider’s device-code flow. A linked account can subsequently sign in through that provider; new accounts still require an invitation. Credentials are stored server-side, bound to the verified provider identity, and refreshed per user. Choose a model and reasoning effort in each assistant; choices are remembered separately per user and list or server. Models are combined from connected providers; Codex and Copilot choices are filtered by account availability. Copilot also uses its account-specific API endpoint. Disconnect is blocked when that provider is the account’s only sign-in method.

The mod-list assistant uses Jev to classify requests in a batch and Flue for conversation and tools. It can inspect the current list, compare other lists the user owns or shares, search cached portal metadata, and explain recommendations with source-list evidence. Explicit requests to add, enable, disable, remove or icebox mods apply directly; requested previews produce one combined review with shared dependencies listed once. Both paths check permissions and the full list snapshot. Stale reviews can be refreshed in place. The assistant cannot administer accounts or operate game servers.

The server assistant reads instance status, enabled mods, saves, settings and recent logs. Running servers expose factory research, production, machines, electric networks, trains and logistics directly through RCON. Typed actions manage research queues, train schedules and requester slots using fresh state checks. Save backups, version selection and process control reuse Facmandu's normal server operations. Applying a mod list requires the displayed review and rechecks its hash. No mod, shell or arbitrary Lua tool is required. Engine queries derive from MIT-licensed AI Agent Bridge modules; provenance is in `src/lib/server/factory-query/UPSTREAM.md`.

Jev evaluates intent, ambiguity and relevant tool groups together using the request and recent private chat context. Simple status requests return directly; other requests use Flue with the selected tool groups. The agent can load another group during investigation. Missing keys, uncertain routing and routing errors retain the full tool menu. Routing never replaces authorization. Lists use their creator's TypeSafe key; servers use the requesting user's key.

Production plans read this save's recipes, unlocks, yields and machine speeds, and compare targets with measured production. Plans expose unresolved recipe choices and report gross inputs with separate byproducts; they do not pretend to solve recycling loops. Factory watches sample once per minute without a model call. Research stalls require five minutes without progress; item deficits compare one-minute consumption and production. Watches and their owner-scoped alert inbox survive restarts. A stopped server pauses sampling; repeated samples do not repeat an alert until the condition clears.

Flue conversation state lives in `.data/agent` (override with `FACMANDU_AGENT_DATA`). Keep this directory private and back it up with the database. One application process owns the runtime; add shared coordination before running multiple app processes. Requests stop after three minutes or cancellation. The application stores private chats per user and list or server, with a chat selector and new-chat action. Flue automatically compacts model context while keeping the visible conversation history. No shell or filesystem tools are exposed to the assistant.

## Checks

```sh
bun run lint
bun run check
bun test
bun audit
bun run build
bun run test:http
```

The HTTP suite uses the actual production build, fresh temporary databases, and isolated external-service fixtures. It covers authentication, permissions, restart recovery, cache reuse, concurrent exports, authenticated logs, and exact mod deployment across two independent servers. It never contacts the real portal or production database.

Login and registration share a 30-attempt/minute budget per client address, with at most two concurrent password operations. Authentication bodies are capped at 16 KiB even when large save uploads are enabled. Configure `ADDRESS_HEADER` only behind a trusted proxy; direct deployments use the peer address.

Biome handles formatting and strict linting. Svelte formatting is temporarily disabled because Biome's experimental formatter does not preserve all Svelte syntax; Svelte is still linted and checked. TypeScript 7 performs type checking through `svelte-check --tsgo`; TypeScript 6 supplies the JS compiler API still needed by build tooling. The `cookie` override stays on its compatible 1.x API until SvelteKit supports cookie 2. Security-sensitive transitive dependencies are pinned through overrides.

`bun run db:push` is for deliberate development schema changes. Normal startup runs the checked-in migrations. When changing the initial schema, regenerate `src/lib/server/db/initial.sql` with `drizzle-kit export` and retain `IF NOT EXISTS` so interrupted initialization can retry.

## Beast deployment

The public application is **https://factorio.luan.sh**. The named Cloudflare Tunnel `facmandu-beast` connects outbound from beast to Facmandu on `127.0.0.1:5173`; it requires no inbound port forwarding or browser-side SSH session.

- App: user service `facmandu-dev.service`, `/home/luan/src/facmandu`, Bun 1.4.2, port 5173.
- Game instances: user services `facmandu-factorio-<id>.service`, data in `/home/luan/.local/share/facmandu/servers`.
- Tunnel: system service `facmandu-cloudflared.service`.
- Public origin: `ORIGIN=https://factorio.luan.sh`.
- Save uploads: `BODY_SIZE_LIMIT=101M`, with a 100 MB file limit.

Back up the database, environment, and instance directories before changing server ownership or storage. Keep credentials private. Do not run two app processes against the same replica.

### Live development on beast

See [infra/dev/README.md](infra/dev/README.md) for live edits at `factorio.luan.sh`, service control, rollback, and the remote Codex thread.

## Docker / Fly (mod library)

```sh
docker build -t facmandu .
docker run -p 3000:3000 -v "$PWD/data:/app/data" \
  -e DATABASE_URL=file:/app/data/facmandu.db \
  -e FACMANDU_CACHE_DIR=/app/data/cache \
  -e ORIGIN=https://your-host.example facmandu
```

The container runs the mod library. Native instance management requires a Linux host with a systemd user session. Builds need no production database or credentials. Supply runtime environment variables through your deployment secret store. The existing Fly workflow runs quality gates before deploying pushes to `main`; Fly credentials and runtime app secrets must already be configured. Beast is managed separately through its systemd services.

Type checking uses TypeScript 7 through `@typescript/native`. Svelte Check 4.7 requires TypeScript 6 alongside it; remove that compatibility dependency when Svelte Check supports TypeScript 7 alone.
