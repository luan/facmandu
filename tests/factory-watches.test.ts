// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from '../src/lib/server/db/migrate';
import * as schema from '../src/lib/server/db/schema';
import { ServerError } from '../src/lib/server/server-files';

const client = createClient({ url: 'file::memory:' });
const initialSchema = await readFile(
	new URL('../src/lib/server/db/initial.sql', import.meta.url),
	'utf8'
);
await migrate(client, initialSchema);
const db = drizzle(client, { schema });
await db.insert(schema.user).values([
	{ id: 'alice', username: 'alice', passwordHash: 'hash' },
	{ id: 'bob', username: 'bob', passwordHash: 'hash' }
]);
await db.insert(schema.managedServer).values({
	id: 'server',
	name: 'Server',
	directory: '/tmp/facmandu-watch-test',
	gamePort: 34197,
	rconPort: 27015
});

const operators = new Set(['alice', 'bob']);
let stopped = false;
let queryCount = 0;
const researchProgress = 0.1;
mock.module('../src/lib/server/db', () => ({ db }));
mock.module('../src/lib/server/servers', () => ({
	canManageServer: (id: string) => operators.has(id),
	requireServer: async (id: string, serverId: string) => {
		if (!operators.has(id)) throw new Error('Server management is restricted');
		const server = await db
			.select()
			.from(schema.managedServer)
			.where(eq(schema.managedServer.id, serverId))
			.get();
		if (!server) throw new Error('Server not found');
		return server;
	}
}));
mock.module('../src/lib/server/factory-query', () => ({
	factoryQuery: (
		_server: schema.ManagedServer,
		request: { tool: string; args: Record<string, unknown> }
	) => {
		queryCount++;
		if (stopped) throw new ServerError(409, 'Start this server to query the factory');
		if (request.args.force === 'typo') throw new ServerError(400, 'unknown force: typo');
		if (request.tool === 'current_research')
			return {
				force: request.args.force,
				researching: true,
				tech: 'automation',
				level: 1,
				progress_precise: researchProgress
			};
		if (request.args.item === 'typo' || request.args.surface === 'typo')
			return { found: false, reason: 'Unknown item or surface' };
		return { found: true, produced_per_min: 3, consumed_per_min: 5 };
	}
}));
const watches = await import('../src/lib/server/factory-watches');

test('watch creation validates running factory names and records pending validation while stopped', async () => {
	await assert.rejects(
		watches.createFactoryWatch('alice', 'server', { kind: 'research_stalled', force: 'typo' }),
		/unknown force/u
	);
	await assert.rejects(
		watches.createFactoryWatch('alice', 'server', {
			kind: 'item_deficit',
			force: 'player',
			surface: 'nauvis',
			item: 'typo'
		}),
		/Unknown item or surface/u
	);
	stopped = true;
	const pending = await watches.createFactoryWatch('alice', 'server', {
		kind: 'research_stalled',
		force: 'player'
	});
	assert.equal(pending.validated, false);
	stopped = false;
	await watches.sampleFactoryWatches();
	assert.equal((await watches.listFactoryWatches('alice', 'server'))[0]?.validated, true);
	await db
		.update(schema.factoryWatch)
		.set({
			lastSampledAt: new Date(Date.now() - 60_000),
			lastChangedAt: new Date(0),
			lastResearch: 'automation:1',
			lastProgress: 100_000
		})
		.where(eq(schema.factoryWatch.id, pending.id));
	stopped = true;
	await watches.sampleFactoryWatches();
	const paused = (await watches.listFactoryWatches('alice', 'server')).find(
		(watch) => watch.id === pending.id
	);
	assert.equal(paused?.lastChangedAt, null);
	stopped = false;
	await watches.sampleFactoryWatches();
	assert.equal((await watches.listFactoryAlerts('alice')).length, 0);
	stopped = true;
	const invalid = await watches.createFactoryWatch('alice', 'server', {
		kind: 'research_stalled',
		force: 'typo'
	});
	stopped = false;
	await watches.sampleFactoryWatches();
	const failed = (await watches.listFactoryWatches('alice', 'server')).find(
		(item) => item.id === invalid.id
	);
	assert.equal(failed?.enabled, false);
	assert.match(failed?.validationError ?? '', /unknown force/u);
});

test('concurrent retries create one persistent watch', async () => {
	const input = {
		kind: 'item_deficit' as const,
		force: 'player',
		surface: 'nauvis',
		item: 'steel-plate'
	};
	const [first, second] = await Promise.all([
		watches.createFactoryWatch('alice', 'server', input),
		watches.createFactoryWatch('alice', 'server', input)
	]);
	assert.equal(first.id, second.id);
	assert.equal(
		(await watches.listFactoryWatches('alice', 'server')).filter(
			(watch) => watch.item === 'steel-plate'
		).length,
		1
	);
});

test('watch CRUD and alert inbox enforce actor ownership and retain alerts after deletion', async () => {
	const watch = await watches.createFactoryWatch('alice', 'server', {
		kind: 'item_deficit',
		force: 'player',
		surface: 'nauvis',
		item: 'iron-plate'
	});
	assert.equal((await watches.listFactoryWatches('bob', 'server')).length, 0);
	await assert.rejects(
		watches.setFactoryWatchEnabled('bob', 'server', watch.id, false),
		/Watch not found/u
	);
	await watches.sampleFactoryWatches();
	const [alert] = await watches.listFactoryAlerts('alice');
	assert.ok(alert);
	assert.equal((await watches.listFactoryAlerts('bob')).length, 0);
	await assert.rejects(watches.readFactoryAlert('bob', alert.id), /Alert not found/u);
	const read = await watches.readFactoryAlert('alice', alert.id);
	assert.ok(read.readAt);
	await watches.removeFactoryWatch('alice', 'server', watch.id);
	assert.equal((await watches.listFactoryAlerts('alice'))[0]?.id, alert.id);
	assert.equal(
		(
			await db
				.select()
				.from(schema.factoryWatchEvent)
				.where(eq(schema.factoryWatchEvent.id, alert.id))
				.get()
		)?.watchId,
		null
	);
});

test('sampler skips revoked operators and a persisted alert state prevents repeat delivery', async () => {
	const watch = await watches.createFactoryWatch('bob', 'server', {
		kind: 'item_deficit',
		force: 'player',
		surface: 'nauvis',
		item: 'copper-plate'
	});
	operators.delete('bob');
	const before = queryCount;
	await watches.sampleFactoryWatches();
	assert.ok(queryCount > before); // Authorized watches still run.
	assert.equal(
		(
			await db
				.select()
				.from(schema.factoryWatchEvent)
				.where(eq(schema.factoryWatchEvent.watchId, watch.id))
		).length,
		0
	);
	operators.add('bob');
	await watches.sampleFactoryWatches();
	assert.equal(
		(
			await db
				.select()
				.from(schema.factoryWatchEvent)
				.where(eq(schema.factoryWatchEvent.watchId, watch.id))
		).length,
		1
	);
	await watches.sampleFactoryWatches(); // The database state survives a process restart.
	assert.equal(
		(
			await db
				.select()
				.from(schema.factoryWatchEvent)
				.where(eq(schema.factoryWatchEvent.watchId, watch.id))
		).length,
		1
	);
	await db
		.delete(schema.factoryWatch)
		.where(
			and(eq(schema.factoryWatch.userId, 'alice'), eq(schema.factoryWatch.serverId, 'server'))
		);
});
