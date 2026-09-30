import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDatabaseClient } from '../src/lib/server/db/worker-client';

const source = readFileSync(new URL('../src/lib/server/db/worker.cjs', import.meta.url), 'utf8');

test('database worker preserves values, transaction ordering, rollback and driver errors', async () => {
	const client = createDatabaseClient({ url: 'file::memory:', intMode: 'bigint' }, source);
	try {
		await client.executeMultiple(
			'CREATE TABLE data (id INTEGER PRIMARY KEY, label TEXT, payload BLOB)'
		);
		await client.execute('INSERT INTO data VALUES (?, ?, ?)', [
			1,
			'first',
			new Uint8Array([1, 2, 255])
		]);
		const tx = await client.transaction('write');
		await tx.execute({ sql: 'UPDATE data SET label = ? WHERE id = 1', args: ['committed'] });
		// A request outside the transaction must wait without preventing the commit from reaching the worker.
		const waiting = client.execute('SELECT * FROM data');
		await tx.commit();
		const result = await waiting;
		assert.equal(result.rows[0]?.[0], 1n);
		assert.equal(result.rows[0]?.label, 'committed');
		assert.deepEqual(result.rows[0]?.payload, new Uint8Array([1, 2, 255]).buffer);
		assert.deepEqual(result.toJSON().rows, [['1', 'committed', 'AQL/']]);
		const rollback = await client.transaction('write');
		await rollback.batch([{ sql: 'UPDATE data SET label = ?', args: ['discarded'] }]);
		rollback.close();
		assert.equal((await client.execute('SELECT label FROM data')).rows[0]?.label, 'committed');
		await assert.rejects(client.execute('INSERT INTO data(id) VALUES (1)'), {
			code: 'SQLITE_CONSTRAINT',
			extendedCode: 'SQLITE_CONSTRAINT_PRIMARYKEY'
		});
		assert.equal((await client.execute('SELECT COUNT(*) AS count FROM data')).rows[0]?.count, 1n);
	} finally {
		client.close();
	}
});

test('database worker closes pending requests and reconnects without an old worker closing the new one', async () => {
	const client = createDatabaseClient({ url: 'file::memory:' }, source);
	const pending = client.execute('SELECT 1');
	const rejected = assert.rejects(pending, /Database is closed/u);
	client.close();
	await rejected;
	assert.equal(client.closed, true);
	client.reconnect();
	try {
		assert.equal((await client.execute('SELECT 2 AS value')).rows[0]?.value, 2);
		assert.equal(client.closed, false);
	} finally {
		client.close();
	}
});

test('a full database request queue still admits the commit that releases waiting reads', async () => {
	const client = createDatabaseClient({ url: 'file::memory:' }, source);
	try {
		const tx = await client.transaction('write');
		const waiting = Promise.all(
			Array.from({ length: 1024 }, () => client.execute('SELECT 1 AS value'))
		);
		await assert.rejects(client.execute('SELECT 2'), /Database is busy/u);
		await tx.commit();
		assert.ok((await waiting).every((result) => result.rows[0]?.value === 1));
	} finally {
		client.close();
	}
});
