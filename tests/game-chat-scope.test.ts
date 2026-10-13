import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { assistantChat } from '../src/lib/server/db/schema';
import { forceChatScope } from '../src/lib/server/game-chat-scope';

test('force history shares across players and excludes other forces and private legacy chats', async () => {
	const sqlite = createClient({ url: ':memory:' });
	try {
		await sqlite.executeMultiple(`CREATE TABLE assistant_chat(id TEXT,game_force TEXT,game_player TEXT);
		INSERT INTO assistant_chat VALUES ('alpha-shared','alpha','Alice'), ('beta-shared','beta','Alice'), ('alice-legacy',NULL,'Alice'), ('bob-legacy',NULL,'Bob'), ('web-private',NULL,NULL);`);
		const db = drizzle(sqlite);
		const visible = async (name: string, force: string) =>
			(
				await db
					.select({ id: assistantChat.id })
					.from(assistantChat)
					.where(forceChatScope({ name, force }))
					.all()
			)
				.map((chat) => chat.id)
				.sort();
		assert.deepEqual(await visible('Bob', 'alpha'), ['alpha-shared', 'bob-legacy']);
		assert.deepEqual(await visible('Alice', 'alpha'), ['alice-legacy', 'alpha-shared']);
		assert.deepEqual(await visible('Bob', 'beta'), ['beta-shared', 'bob-legacy']);
	} finally {
		sqlite.close();
	}
});
