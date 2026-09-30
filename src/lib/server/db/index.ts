import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Config } from '@libsql/client';
import { and, eq, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import initialSchema from './initial.sql?raw';
import { migrate } from './migrate';
import * as schema from './schema';
import workerSource from './worker.cjs?raw';
import { createDatabaseClient } from './worker-client';

// Route analysis imports server modules during a build; it must never open the live replica.
const connectionUrl = building ? 'file::memory:' : env.TURSO_CONNECTION_URL || env.DATABASE_URL;
if (!connectionUrl) throw new Error('TURSO_CONNECTION_URL or DATABASE_URL must be set');

const clientConfig: Omit<Config, 'fetch'> = { url: connectionUrl };
if (!building && env.FACMANDU_REPLICA_PATH && !connectionUrl.startsWith('file:')) {
	const path = resolve(env.FACMANDU_REPLICA_PATH);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	Object.assign(clientConfig, {
		url: `file:${path}`,
		syncUrl: connectionUrl,
		syncInterval: 60,
		readYourWrites: true
	});
}
if (!building && env.TURSO_AUTH_TOKEN) {
	clientConfig.authToken = env.TURSO_AUTH_TOKEN;
}

// Vite reloads this module when schema and server code change. One replica needs one worker.
type DatabaseState = {
	client: ReturnType<typeof createDatabaseClient>;
	source: string;
	config: string;
};
const processState = globalThis as typeof globalThis & { __facmanduDatabase?: DatabaseState };
const previous = processState.__facmanduDatabase;
const configKey = JSON.stringify(clientConfig);
if (previous && (previous.source !== workerSource || previous.config !== configKey))
	previous.client.close();
const client =
	previous && !previous.client.closed
		? previous.client
		: createDatabaseClient(clientConfig, workerSource);
if (!previous || previous.client !== client)
	process.once('sveltekit:shutdown', () => client.close());
processState.__facmanduDatabase = { client, source: workerSource, config: configKey };

export const db = drizzle(client, { schema });

let initialization: Promise<void> | undefined;
export function initializeDatabase(): Promise<void> {
	if (client.closed) {
		client.reconnect();
		initialization = undefined;
	}
	if (initialization) return initialization;
	const started = (async () => {
		if (clientConfig.syncUrl) {
			try {
				await client.sync();
			} catch {
				console.warn('Database sync unavailable; checking the existing local replica');
			}
		}
		await migrate(client, initialSchema);
	})();
	initialization = started;
	void started.catch(() => {
		if (initialization === started) initialization = undefined;
	});
	return started;
}

// Ownership and collaboration are checked in one indexed query.
export async function userHasModlistAccess(userId: string, modlistId: string): Promise<boolean> {
	const access = await db
		.select({ id: schema.modList.id })
		.from(schema.modList)
		.leftJoin(
			schema.modListCollaborator,
			and(
				eq(schema.modListCollaborator.modlistId, schema.modList.id),
				eq(schema.modListCollaborator.userId, userId)
			)
		)
		.where(
			and(
				eq(schema.modList.id, modlistId),
				or(eq(schema.modList.owner, userId), eq(schema.modListCollaborator.userId, userId))
			)
		)
		.get();
	return Boolean(access);
}
