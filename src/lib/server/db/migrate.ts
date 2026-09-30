import type { Client } from '@libsql/client';

// Additive migrations preserve existing lists, sessions, and cached metadata.
async function migrateInitial(client: Client, initialSchema: string) {
	const registry = await client.execute(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'facmandu_migration'"
	);
	if (
		registry.rows.length &&
		(await client.execute('SELECT version FROM facmandu_migration WHERE version = 1')).rows.length
	)
		return;
	await client.execute(
		'CREATE TABLE IF NOT EXISTS facmandu_migration (version INTEGER PRIMARY KEY)'
	);
	const applied = await client.execute('SELECT version FROM facmandu_migration WHERE version = 1');
	if (applied.rows.length) return;
	const tx = await client.transaction('write');
	try {
		const core = await tx.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'modlist'"
		);
		if (!core.rows.length) await tx.executeMultiple(initialSchema);
		await tx.execute(`CREATE TABLE IF NOT EXISTS portal_cache (
			key TEXT PRIMARY KEY NOT NULL, body TEXT, status INTEGER NOT NULL,
			fetched_at INTEGER NOT NULL, retry_after INTEGER NOT NULL DEFAULT 0,
			etag TEXT, last_modified TEXT)`);
		const lists = await tx.execute('PRAGMA table_info(modlist)');
		if (lists.rows.length && !lists.rows.some((row) => row.name === 'factorio_version')) {
			await tx.execute(
				"ALTER TABLE modlist ADD COLUMN factorio_version TEXT NOT NULL DEFAULT '2.0'"
			);
			await tx.execute(
				"UPDATE modlist SET factorio_version = COALESCE((SELECT factorio_version FROM mod WHERE modlist_id = modlist.id AND enabled = 1 AND factorio_version IS NOT NULL GROUP BY factorio_version ORDER BY COUNT(*) DESC LIMIT 1), '2.0')"
			);
		}
		const mods = await tx.execute('PRAGMA table_info(mod)');
		if (mods.rows.length && !mods.rows.some((row) => row.name === 'auto_dependency')) {
			await tx.execute('ALTER TABLE mod ADD COLUMN auto_dependency INTEGER NOT NULL DEFAULT 0');
		}
		await tx.execute('INSERT OR IGNORE INTO facmandu_migration (version) VALUES (1)');
		await tx.commit();
	} catch (cause) {
		await tx.rollback();
		throw cause;
	} finally {
		tx.close();
	}
}

export async function migrate(client: Client, initialSchema: string) {
	await migrateInitial(client, initialSchema);
	await migrateAccounts(client);
	await client.executeMultiple(`CREATE TABLE IF NOT EXISTS native_server (
		id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE,
		game_port INTEGER NOT NULL UNIQUE, rcon_port INTEGER NOT NULL UNIQUE,
		selected_modlist TEXT REFERENCES modlist(id) ON DELETE SET NULL);
		CREATE TABLE IF NOT EXISTS native_server_job (
		server_id TEXT PRIMARY KEY NOT NULL REFERENCES native_server(id) ON DELETE CASCADE,
		body TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS native_server_provision_job (
		server_id TEXT PRIMARY KEY NOT NULL REFERENCES native_server(id) ON DELETE CASCADE,
		body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS server_assistant_turn (
   id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
   server_id TEXT NOT NULL REFERENCES native_server(id) ON DELETE CASCADE,
   prompt TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', state TEXT NOT NULL,
   results TEXT NOT NULL DEFAULT '[]', receipt TEXT, model TEXT, effort TEXT, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS server_assistant_turn_owner ON server_assistant_turn(user_id,server_id,created_at);
CREATE TABLE IF NOT EXISTS recommendation_feedback (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 list_id TEXT NOT NULL REFERENCES modlist(id) ON DELETE CASCADE,
 mod_name TEXT NOT NULL, PRIMARY KEY(user_id,list_id,mod_name));`);
	await migrateChats(client);
	await client.executeMultiple(`CREATE TABLE IF NOT EXISTS factory_watch (
	 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	 server_id TEXT NOT NULL REFERENCES native_server(id) ON DELETE CASCADE,
	 kind TEXT NOT NULL CHECK(kind IN ('research_stalled','item_deficit')),
	 force TEXT NOT NULL, surface TEXT, item TEXT, enabled INTEGER NOT NULL DEFAULT 1,
	 validated INTEGER NOT NULL DEFAULT 0, validation_error TEXT,
	 created_at INTEGER NOT NULL, last_sampled_at INTEGER, last_changed_at INTEGER,
	 last_research TEXT, last_progress INTEGER, alerting INTEGER NOT NULL DEFAULT 0);
	 CREATE INDEX IF NOT EXISTS factory_watch_owner ON factory_watch(user_id,server_id);
	 CREATE UNIQUE INDEX IF NOT EXISTS factory_watch_identity ON factory_watch(user_id,server_id,kind,force,coalesce(surface,''),coalesce(item,''));
	 CREATE TABLE IF NOT EXISTS factory_watch_event (
	 id TEXT PRIMARY KEY NOT NULL, watch_id TEXT REFERENCES factory_watch(id) ON DELETE SET NULL,
	 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	 server_id TEXT NOT NULL REFERENCES native_server(id) ON DELETE CASCADE,
	 message TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);
	 CREATE INDEX IF NOT EXISTS factory_watch_event_owner ON factory_watch_event(user_id,created_at);`);
}

async function migrateAccounts(client: Client) {
	const tx = await client.transaction('write');
	try {
		// Date-based IDs avoid the numbered migrations used by earlier server-manager releases.
		const columns = new Set(
			(await tx.execute('PRAGMA table_info(user)')).rows.map((row) => row.name)
		);
		if (
			!(await tx.execute('SELECT version FROM facmandu_migration WHERE version = 2026092701')).rows
				.length
		) {
			if (!columns.has('is_admin')) {
				await tx.execute('ALTER TABLE user ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
				await tx.execute("UPDATE user SET is_admin = 1 WHERE username = 'luan'");
			}
			if (!columns.has('typesafe_api_key'))
				await tx.execute('ALTER TABLE user ADD COLUMN typesafe_api_key TEXT');
			await tx.executeMultiple(`CREATE TABLE IF NOT EXISTS invite (
    hash TEXT PRIMARY KEY NOT NULL, created_by TEXT NOT NULL REFERENCES user(id),
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    used_by TEXT REFERENCES user(id), revoked INTEGER NOT NULL DEFAULT 0);
    INSERT INTO facmandu_migration (version) VALUES (2026092701);`);
		}
		if (
			!(await tx.execute('SELECT version FROM facmandu_migration WHERE version = 2026092702')).rows
				.length
		) {
			if (!columns.has('codex_subject'))
				await tx.execute('ALTER TABLE user ADD COLUMN codex_subject TEXT');
			if (!columns.has('codex_credentials'))
				await tx.execute('ALTER TABLE user ADD COLUMN codex_credentials TEXT');
			if (!columns.has('agent_model'))
				await tx.execute("ALTER TABLE user ADD COLUMN agent_model TEXT NOT NULL DEFAULT 'gpt-5.4'");
			await tx.executeMultiple(`CREATE UNIQUE INDEX IF NOT EXISTS user_codex_subject ON user(codex_subject);
    INSERT INTO facmandu_migration (version) VALUES (2026092702);`);
		}
		if (
			!(await tx.execute('SELECT version FROM facmandu_migration WHERE version = 2026092901')).rows
				.length
		) {
			if (!columns.has('meta_subject'))
				await tx.execute('ALTER TABLE user ADD COLUMN meta_subject TEXT');
			if (!columns.has('meta_credentials'))
				await tx.execute('ALTER TABLE user ADD COLUMN meta_credentials TEXT');
			if (!columns.has('copilot_subject'))
				await tx.execute('ALTER TABLE user ADD COLUMN copilot_subject TEXT');
			if (!columns.has('copilot_credentials'))
				await tx.execute('ALTER TABLE user ADD COLUMN copilot_credentials TEXT');
			await tx.executeMultiple(`CREATE UNIQUE INDEX IF NOT EXISTS user_meta_subject ON user(meta_subject);
    CREATE UNIQUE INDEX IF NOT EXISTS user_copilot_subject ON user(copilot_subject);
    INSERT INTO facmandu_migration (version) VALUES (2026092901);`);
		}
		if (
			!(await tx.execute('SELECT version FROM facmandu_migration WHERE version = 2026092703')).rows
				.length
		) {
			await tx.executeMultiple(`CREATE TABLE IF NOT EXISTS modlist_plan (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    list_id TEXT NOT NULL REFERENCES modlist(id) ON DELETE CASCADE, snapshot TEXT NOT NULL,
    body TEXT NOT NULL, created_at INTEGER NOT NULL, applied INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS assistant_turn (
     id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
     list_id TEXT NOT NULL REFERENCES modlist(id) ON DELETE CASCADE, prompt TEXT NOT NULL,
     answer TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, created_at INTEGER NOT NULL, receipt TEXT, model TEXT);
    CREATE INDEX IF NOT EXISTS assistant_turn_owner ON assistant_turn(user_id, list_id, created_at);
    CREATE INDEX IF NOT EXISTS modlist_plan_owner ON modlist_plan(user_id, list_id, created_at);
    INSERT INTO facmandu_migration (version) VALUES (2026092703);`);
		}
		if (
			!(await tx.execute('PRAGMA table_info(assistant_turn)')).rows.some(
				(row) => row.name === 'mods'
			)
		) {
			await tx.execute("ALTER TABLE assistant_turn ADD COLUMN mods TEXT NOT NULL DEFAULT '[]'");
		}
		if (
			!(await tx.execute('PRAGMA table_info(assistant_turn)')).rows.some(
				(row) => row.name === 'results'
			)
		)
			await tx.execute("ALTER TABLE assistant_turn ADD COLUMN results TEXT NOT NULL DEFAULT '[]'");

		if (
			!(await tx.execute('PRAGMA table_info(assistant_turn)')).rows.some(
				(row) => row.name === 'effort'
			)
		)
			await tx.execute('ALTER TABLE assistant_turn ADD COLUMN effort TEXT');

		await tx.commit();
	} catch (cause) {
		await tx.rollback();
		throw cause;
	} finally {
		tx.close();
	}
}

async function migrateChats(client: Client) {
	const tx = await client.transaction('write');
	try {
		if (
			(await tx.execute('SELECT version FROM facmandu_migration WHERE version = 2026092704')).rows
				.length
		) {
			await tx.commit();
			return;
		}
		await tx.executeMultiple(`CREATE TABLE assistant_chat (
   id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
   list_id TEXT REFERENCES modlist(id) ON DELETE CASCADE,
   server_id TEXT REFERENCES native_server(id) ON DELETE CASCADE,
   title TEXT NOT NULL DEFAULT 'New chat', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
   compacted_at INTEGER, CHECK ((list_id IS NULL) != (server_id IS NULL)));
   CREATE INDEX assistant_chat_owner ON assistant_chat(user_id,list_id,server_id,updated_at);`);
		for (const table of ['assistant_turn', 'server_assistant_turn', 'modlist_plan']) {
			await tx.execute(
				`ALTER TABLE ${table} ADD COLUMN chat_id TEXT REFERENCES assistant_chat(id) ON DELETE CASCADE`
			);
			await tx.execute(`CREATE INDEX ${table}_chat ON ${table}(chat_id,created_at)`);
		}
		// Keep the original Flue instance ID so old conversations retain their model context.
		for (const [table, target, prefix] of [
			['assistant_turn', 'list_id', ''],
			['server_assistant_turn', 'server_id', 'server-']
		]) {
			await tx.execute(`INSERT INTO assistant_chat(id,user_id,${target},title,created_at,updated_at)
    SELECT user_id || '-${prefix}' || ${target} || '-chat', user_id, ${target},
    'Previous conversation', MIN(created_at), MAX(created_at) FROM ${table} GROUP BY user_id,${target}`);
			await tx.execute(
				`UPDATE ${table} SET chat_id = user_id || '-${prefix}' || ${target} || '-chat'`
			);
		}
		await tx.execute(`INSERT OR IGNORE INTO assistant_chat(id,user_id,list_id,title,created_at,updated_at)
   SELECT user_id || '-' || list_id || '-chat',user_id,list_id,'Previous conversation',MIN(created_at)*1000,MAX(created_at)*1000 FROM modlist_plan GROUP BY user_id,list_id`);
		await tx.execute(`UPDATE modlist_plan SET chat_id = user_id || '-' || list_id || '-chat'`);
		await tx.execute('INSERT INTO facmandu_migration(version) VALUES (2026092704)');
		await tx.commit();
	} catch (cause) {
		await tx.rollback();
		throw cause;
	} finally {
		tx.close();
	}
}
