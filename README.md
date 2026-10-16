# Facmandu

A Factorio server manager with a shared mod library. Manage multiple instances, choose a list for each server, review the exact changes, and apply them while the game is stopped.

## Workflows

- **Servers** is the home screen. Each server has its own Console, Mods, Saves, Settings, and Access workspace. Instances, selected lists, jobs, logs, and command history stay scoped to that server. Installed versions and settings load independently of remote release checks.
- **Mod library** contains reusable lists with an explicit Factorio branch. Imports retain compatible versions. Mod details let you choose a preferred release. Background repair fills missing metadata, resolves required dependencies, and reports conflicts that need a choice. Locked mods and explicit bundled-mod choices are preserved.
- **Review and apply** compares exact installed versions with the selected list. A changed review must be reviewed again. Applying requires a stopped server; archives outside the list are disabled, not deleted. Unpacked development mods cannot be overwritten. Interrupted jobs are reported after restart and are never silently replayed.
- **Console** combines live logs and RCON with command completion, keyboard history, syntax highlighting, level/source filters, search, pause/follow, copy, and download. Rendering and retained output are bounded.
- **Activity** follows repairs, exports, downloads, shutdown, and mod deployment across SPA navigation. Ordinary forms submit without document reloads.
- **Recommendations** start with compatible optional companions and reject known conflicts. Optional Decisions API curation scores only these verified candidates; AI never decides dependency correctness.

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

**Start** resumes a newer complete autosave under the original world's filename, so normal saves and shutdown keep that name. **Load this save** loads an explicitly chosen archive once; subsequent starts resume its newer autosaves. Switching worlds excludes autosaves from the previous world. The Saves workspace and assistant can rename archives while stopped without overwriting another save; renaming keeps the selected world.

**Saves → Automatic Dropbox backups** uploads completed, changed saves once per minute while the app is running. Connect Dropbox in Account settings first. Each server overwrites `/servers/<serverId>/cloud-current.zip` using the recorded Dropbox revision; Dropbox file history holds previous versions. Size and content hash are verified before recording success. Revision conflicts fail without overwriting an outside edit. A private `cloud-recovery.zip` retains the last verified local snapshot; old backups are preserved. Exact revision restores require a stopped server and preserve the current world before replacing it.

In **Server → Mods**, choose a list and use **Sync list from server** while stopped to copy installed versions and enabled flags into that list. Other entries become disabled; existing metadata and locks remain. This direction updates the list without changing the server’s mods. **Apply a mod list** still reviews changes in the other direction.

**Saves → Create save** configures the world before generation: native presets, seed, map dimensions, resource frequency/size/richness, terrain, peaceful mode, evolution, expansion, pollution, and research cost. Options use the selected installation and enabled mods. Generate a native map preview before creating; changing settings marks the preview stale. Generation uses an isolated profile so the current server can keep running. New archives are published only after generation succeeds and never overwrite existing saves.

`FACMANDU_OPERATOR_USER_IDS` is a comma-separated allowlist of Facmandu account IDs. Ordinary users can still use shared mod lists. Server settings apply on the next start. The Mod settings workspace shows each mod’s settings, defaults, allowed choices and ranges. While stopped, edits patch Factorio’s native `mods/mod-settings.dat`: startup settings apply on restart and runtime defaults apply to new saves. Runtime global settings can also be changed through RCON in the owning mod’s context for the loaded save. Running instances show effective values; player defaults are read-only because some mods require a player context when handling changes. Player access changes are sent over RCON when running and saved on disk. Downloads use Factorio's official headless distribution; mod downloads need a Factorio username and service token unless the archive is already cached.

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

Add an OpenAI API key in Account settings to enable assistant routing and automatic recommendation ranking. This is separate from connecting Codex. The Decisions API uses `gpt-6-luna`. Every list uses its creator’s key, including requests from collaborators. There is no global key fallback. Results are validated and cached by candidate and list contents; list changes invalidate stale scores. No key is needed for deterministic recommendations.

## Accounts and assistant

**Add provider** connects existing Codex, Muse, or Copilot accounts or saves API keys for Pi providers such as Anthropic, Google, OpenAI, OpenRouter, and DeepSeek. Connected providers share one compact list. Keys stay private to each account; their models become available in the assistant. API keys do not add sign-in methods. Providers requiring cloud identity or endpoint configuration are not offered yet.

Account creation requires a single-use invitation from Administration. Invitations expire after seven days and can be revoked. Administrators can grant or remove administrator roles; the last administrator cannot be removed. The existing `luan` account is promoted once by migration. On a fresh installation, provision the first administrator directly in the database; public registration never bootstraps an administrator.

Connect Codex, Muse (Meta), or GitHub Copilot in Account settings using the provider’s device-code flow. A linked account can subsequently sign in through that provider; new accounts still require an invitation. Credentials are stored server-side, bound to the verified provider identity, and refreshed per user. Choose a model and reasoning effort in each assistant; choices are remembered separately per user and list or server. Models are combined from connected providers; Codex and Copilot choices are filtered by account availability. Copilot also uses its account-specific API endpoint. Disconnect is blocked when that provider is the account’s only sign-in method.

The microphone button starts a spoken conversation using the linked Codex account and the browser's microphone. Voice reuses pi-voice's Codex realtime protocol (`gpt-live-1-codex`); account availability is checked when connecting. Spoken requests delegate to the same Flue assistant, selected model, tools and permissions as typed requests. Results remain in the current private chat; live speech captions appear above the composer. Mute keeps the conversation connected, and End, closing the assistant or changing chats releases the microphone and connection. HTTPS or localhost and microphone permission are required. No API key or Pi process is exposed to the browser.

The mod-list assistant uses the OpenAI Decisions API to classify requests in a batch and Flue for conversation and tools. It can inspect the current list, compare other lists the user owns or shares, search cached portal metadata, and explain recommendations with source-list evidence. Explicit requests to add, enable, disable, remove or icebox mods apply directly; requested previews produce one combined review with shared dependencies listed once. Both paths check permissions and the full list snapshot. Stale reviews can be refreshed in place. The assistant cannot administer accounts; server operations require operator access.

The server assistant reads instance status, enabled mods, saves, settings and recent logs. Running servers expose factory research, production, machines, electric networks, trains and logistics directly through RCON. Typed actions manage research queues, train schedules and requester slots using fresh state checks. Save backups, version selection and process control reuse Facmandu's normal server operations. Portal metadata reads use the installed mod context even without a linked list. The server assistant edits its linked mod list through the same dependency planner as list chats. It can install a requested list using a fresh plan hash and follow the actual download job without starting the game. The selected save, linked list, pending changes and installation errors share the server context. Mod settings have their own tab; a stopped server uses an isolated native export when a mod depends on settings-stage APIs the source parser cannot reproduce. Unmapped native definitions appear together under Other installed mod settings until a running game provides their owners. No mod, shell or arbitrary Lua tool is required. Engine queries derive from MIT-licensed AI Agent Bridge modules; provenance is in `src/lib/server/factory-query/UPSTREAM.md`.

Enable the **In-game assistant** in a server's Settings, with its own model and effort. Players ask `@ why has green science stopped?` (the longer `@assistant` prefix also works); the existing Decisions/Flue pipeline receives their live force, surface and position. Replies go to the player’s entire force through RCON, with Factorio icons and clickable map positions. Each player has a separate conversation visible in the enabling operator's web assistant; `@assistant new chat` starts fresh. No client mod is needed. Web chats remain separate from player conversations.

In-game factory actions default to disabled. Operators may allow Factorio administrators or named players to request research, train and requester changes within their own force. Permissions and live connection are checked again for each tool; the engine rechecks player connection, force and administrator status immediately before a write. In-game chats cannot load server administration, logs, saves, account controls or website watches. Historical log messages are skipped after enabling or restarting the web app, requests are limited to one per player every 15 seconds and ten per server per minute, and disabling the feature stops pending responses. Model usage is charged to the operator's connected account.

The Decisions API evaluates intent, ambiguity and relevant tool groups together using the request and recent private chat context. Simple status requests return directly; other requests use Flue with the selected tool groups. The agent can load another group during investigation. Missing keys, uncertain routing and routing errors retain the full tool menu. Routing never replaces authorization. Lists use their creator's OpenAI key; servers use the requesting user's key.

Native blueprint tools accept item-placeable entities from the installed game and mods, foundation tiles, filters, circuit wires, control behavior and supported custom inserter vectors. Drafts have immutable `designId` references for inspection, revision and placement; only the latest displayed revision expands inline. Placement creates normal construction ghosts and uses real construction stock. Import validation and ghost placement do not prove working supplies or sustained throughput: verify delivered output over game ticks. Use a separate server and save for mutation QA.

NeuralWatt offers its native **No thinking** control separately from the existing effort levels. Its current DeepSeek factory-image path has not passed visual QA, so that model uses structured factory reads; the harness can still render its designs for players. Forced thinking-token budgets produced degenerate output in native trials and are not sent. A model-call output bound permits recovery without imposing a time limit on the whole request.

Production plans read this save's recipes, unlocks, yields and machine speeds, and compare targets with measured production. Plans expose unresolved recipe choices and report gross inputs with separate byproducts; they do not pretend to solve recycling loops. Factory watches sample once per minute without a model call. Research stalls require five minutes without progress; item deficits compare one-minute consumption and production. Watches and their owner-scoped alert inbox survive restarts. A stopped server pauses sampling; repeated samples do not repeat an alert until the condition clears.

Flue conversation state lives in `.data/agent` (override with `FACMANDU_AGENT_DATA`). Keep this directory private and back it up with the database. One application process owns the runtime; add shared coordination before running multiple app processes. There is no fixed three-minute request cutoff. Explicit Stop cancels a response; browser disconnection and chat navigation leave its work running. Follow-ups steer an active request, and periodic progress reports keep long operations visible. Empty or truncated model replies get bounded continuation attempts using their recorded tool results. Deployments defer restarts while assistant work is active. The application stores private chats per user and list or server, with a chat selector and new-chat action. The context bar reports provider limits and automatic compaction status. Context compacts near the selected model’s window, reserving output headroom and preserving completed writes, visible history and native draft files. The pinned Flue 2.2.2 patch also applies updated compaction settings during a run; remove it when an upstream release passes the same mid-run compaction test. No shell or filesystem tools are exposed to the assistant. New item-production layouts use the vendored MIT Interpose compiler: Toby supplies products, rates, item/fluid input ports, output belts, selected recipes and a bounded area; local port coordinates are optional, with compact west-input/south-output defaults. Reviewed native Lua generates the machines, belts and connected power network outside the game process. Live prototype reads filter locked recipes, surface restrictions and unavailable entity tiers. Raw entity creation and model-written layout programs are no longer assistant tools. The initial compiler supports ground item chains with selected electric crafting-machine prototypes and an optional electric furnace, including fluid-fed solid products such as plastic and battery-fed robot frames. Select the primary tier in `tiers.machine` and additional prototypes in `tiers.crafters`. Fluid inputs use native rotated machine connections and separate pipe routes; fluid-only recipes, fluid products, modules, byproducts and custom circuit controllers still need qualified templates. Unsupported cases return a concrete limitation rather than falling back to arbitrary geometry. Compilation automatically runs the native sandbox trial using the declared supply budgets and the generated power network. Failed or paused trials block ghost placement; completed trials retain measured rates. Two compiler attempts per product set bound repairs. Safe world-placement checks remain mandatory.

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

- App: user service `facmandu-dev.service`, verified releases at `/home/luan/.local/share/facmandu-deploy/current`, Bun 1.4.2, port 5173.
- Game instances: user services `facmandu-factorio-<id>.service`, data in `/home/luan/.local/share/facmandu/servers`.
- Tunnel: system service `facmandu-cloudflared.service`.
- Public origin: `ORIGIN=https://factorio.luan.sh`.
- Save uploads: `BODY_SIZE_LIMIT=101M`, with a 100 MB file limit.

Back up the database, environment, and instance directories before changing server ownership or storage. Keep credentials private. Do not run two app processes against the same replica.

### Automatic deployment and rollback

Pushes to `main` run quality checks. Beast polls for a successful check on the exact main revision, builds in an isolated release, restarts the existing app, and verifies the running revision, database, login, and private-source boundaries. Failed health checks restore the previous source/service configuration. Game processes and all runtime data stay in place. See [infra/beast/README.md](infra/beast/README.md) for installation, status, pausing, and rollback.

The original `/home/luan/src/facmandu` checkout is retained as the first rollback source and holds existing assistant state. [infra/dev/README.md](infra/dev/README.md) documents the legacy manual development setup; direct edits there no longer publish changes after automatic releases are enabled.

## Docker / Fly (mod library)

```sh
docker build -t facmandu .
docker run -p 3000:3000 -v "$PWD/data:/app/data" \
  -e DATABASE_URL=file:/app/data/facmandu.db \
  -e FACMANDU_CACHE_DIR=/app/data/cache \
  -e ORIGIN=https://your-host.example facmandu
```

The container runs the mod library. Native instance management requires a Linux host with a systemd user session. Builds need no production database or credentials. Supply runtime environment variables through your deployment secret store. GitHub Actions runs quality gates only; it never deploys to Fly. The historical Fly configuration is retained for an optional mod-library container, while automatic application deployment targets beast through its existing systemd service.

Type checking uses TypeScript 7 through `@typescript/native`. Svelte Check 4.7 requires TypeScript 6 alongside it; remove that compatibility dependency when Svelte Check supports TypeScript 7 alone.
