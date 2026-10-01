import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { migrate } from '../src/lib/server/db/migrate';

const initialSchema = await readFile(
	new URL('../src/lib/server/db/initial.sql', import.meta.url),
	'utf8'
);

test('additive migration preserves list data, infers compatibility, and is idempotent', async () => {
	const client = createClient({ url: 'file::memory:' });
	try {
		await client.executeMultiple(
			`CREATE TABLE user (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT); INSERT INTO user VALUES ('luan', 'luan', 'hash'); CREATE TABLE modlist (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE mod (id TEXT PRIMARY KEY, modlist_id TEXT, enabled INTEGER, factorio_version TEXT); INSERT INTO modlist VALUES ('list', 'Existing list'); INSERT INTO mod VALUES ('mod', 'list', 1, '2.1');`
		);
		await client.executeMultiple(
			'CREATE TABLE facmandu_migration (version INTEGER PRIMARY KEY); INSERT INTO facmandu_migration VALUES (2);'
		);

		await client.executeMultiple(`CREATE TABLE assistant_turn (
   id TEXT PRIMARY KEY, user_id TEXT NOT NULL, list_id TEXT NOT NULL, prompt TEXT NOT NULL,
   answer TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, created_at INTEGER NOT NULL, receipt TEXT, model TEXT);
   INSERT INTO assistant_turn VALUES ('old-turn','luan','list','Existing question','Existing answer','done',1000,'old-receipt','gpt-6-luna');
   CREATE TABLE modlist_plan (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,list_id TEXT NOT NULL,snapshot TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,applied INTEGER NOT NULL DEFAULT 0);
   INSERT INTO modlist_plan VALUES ('old-plan','luan','list','snapshot','{}',1,0);`);
		await migrate(client, initialSchema);
		assert.equal(
			(await client.execute("SELECT is_admin FROM user WHERE username = 'luan'")).rows[0]?.is_admin,
			1
		);
		await client.execute("UPDATE user SET is_admin = 0 WHERE username = 'luan'");
		await migrate(client, initialSchema);
		assert.equal(
			(await client.execute("SELECT is_admin FROM user WHERE username = 'luan'")).rows[0]?.is_admin,
			0
		);
		const prior = (await client.execute('SELECT chat_id,answer,receipt FROM assistant_turn'))
			.rows[0];
		assert.equal(prior?.chat_id, 'luan-list-chat');
		assert.equal(prior?.answer, 'Existing answer');
		assert.equal(prior?.receipt, 'old-receipt');
		assert.equal(
			(await client.execute('SELECT game_player FROM assistant_chat')).rows[0]?.game_player,
			null
		);
		await client.execute("UPDATE assistant_chat SET game_player = 'Alice'");
		await migrate(client, initialSchema);
		assert.equal(
			(await client.execute('SELECT game_player FROM assistant_chat')).rows[0]?.game_player,
			'Alice'
		);
		assert.equal(
			(await client.execute('SELECT chat_id FROM modlist_plan')).rows[0]?.chat_id,
			prior?.chat_id
		);
		assert.equal(
			(await client.execute('SELECT COUNT(*) AS count FROM assistant_chat')).rows[0]?.count,
			1
		);
		const list = (await client.execute('SELECT name, factorio_version FROM modlist')).rows[0];
		assert.ok(list);
		assert.equal(list.name, 'Existing list');
		assert.equal(list.factorio_version, '2.1');
		assert.equal(
			(await client.execute('SELECT auto_dependency FROM mod')).rows[0]?.auto_dependency,
			0
		);
	} finally {
		client.close();
	}
});

test('a fresh database initializes the complete schema and retries without changing data', async () => {
	const client = createClient({ url: 'file::memory:' });
	try {
		await migrate(client, initialSchema);
		await client.execute(
			"INSERT INTO user(id, username, password_hash) VALUES ('owner', 'owner', 'hash')"
		);
		await client.execute(
			"INSERT INTO modlist(id, user_id, name) VALUES ('list', 'owner', 'New list')"
		);
		await migrate(client, initialSchema);
		assert.equal(
			(await client.execute('SELECT factorio_version FROM modlist')).rows[0]?.factorio_version,
			'2.0'
		);
		assert.equal((await client.execute('SELECT COUNT(*) AS count FROM user')).rows[0]?.count, 1);
	} finally {
		client.close();
	}
});
