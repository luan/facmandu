// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { afterAll, mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { isActionFailure } from '@sveltejs/kit';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from '../src/lib/server/db/migrate';
import * as schema from '../src/lib/server/db/schema';

if (process.env.FACMANDU_ACTION_RACE_TEST_CHILD !== '1') {
	test('concurrent account and mod actions preserve sign-in and lock protection', () => {
		const result = spawnSync(process.execPath, ['test', fileURLToPath(import.meta.url)], {
			env: { ...process.env, FACMANDU_ACTION_RACE_TEST_CHILD: '1' },
			encoding: 'utf8'
		});
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	});
} else {
	const client = createClient({ url: 'file::memory:' });
	await migrate(
		client,
		readFileSync(new URL('../src/lib/server/db/initial.sql', import.meta.url), 'utf8')
	);
	const db = drizzle(client, { schema });
	afterAll(() => client.close());
	mock.module('$env/dynamic/private', () => ({ env: {} }));
	mock.module('../src/lib/server/db', () => ({ db, userHasModlistAccess: async () => true }));
	// External metadata repair and broadcasts are independent of the guarded mutations.
	mock.module('../src/lib/server/modlist-repair', () => ({
		repairProgress: () => null,
		startModlistRepair: () => {}
	}));
	mock.module('../src/lib/server/realtime', () => ({ publishModlistEvent: () => {} }));
	mock.module('../src/lib/server/portal-cache', () => ({
		getPortalMod: async () => ({ data: null })
	}));
	const { actions: accountActions } = await import('../src/routes/(app)/settings/+page.server');
	const { actions: modActions } = await import('../src/routes/(app)/modlists/[id]/+page.server');
	const { codex, meta } = accountActions;
	const { toggleEssential } = modActions;
	assert.ok(codex);
	assert.ok(meta);
	assert.ok(toggleEssential);
	type AccountEvent = Parameters<NonNullable<typeof accountActions.codex>>[0];
	type ModEvent = Parameters<NonNullable<typeof modActions.toggleStatus>>[0];
	function event(userId: string, fields: Record<string, string>) {
		return {
			locals: {
				user: { id: userId, username: userId, isAdmin: false },
				session: { id: 'audit-session', userId, expiresAt: new Date(0) }
			},
			params: { id: userId },
			request: new Request(`https://example.test/modlists/${userId}`, {
				method: 'POST',
				body: new URLSearchParams(fields)
			})
		};
	}

	for (const passwordless of [true, false]) {
		test(`concurrent provider disconnects ${passwordless ? 'retain a passwordless sign-in' : 'allow a password-backed account'}`, async () => {
			const id = passwordless ? 'oauth-only' : 'password-backed';
			await db.insert(schema.user).values({
				id,
				username: id,
				passwordHash: passwordless ? 'oauth:fixture' : '$argon2id$fixture',
				codexSubject: `codex:${id}`,
				codexCredentials: '{}',
				metaSubject: `meta:${id}`,
				metaCredentials: '{}'
			});
			const results = await Promise.all([
				codex(event(id, { disconnect: 'true' }) as unknown as AccountEvent),
				meta(event(id, { disconnect: 'true' }) as unknown as AccountEvent)
			]);
			const row = (
				await client.execute({
					sql: 'SELECT codex_subject, meta_subject, copilot_subject FROM user WHERE id = ?',
					args: [id]
				})
			).rows[0];
			assert.ok(row);
			const remaining = Object.values(row).filter(Boolean).length;
			assert.equal(remaining, passwordless ? 1 : 0);
			assert.equal(results.filter(isActionFailure).length, passwordless ? 1 : 0);
		});
	}

	for (const operation of ['toggleStatus', 'removeMod', 'moveToIcebox'] as const) {
		const action = modActions[operation];
		assert.ok(action);
		test(`concurrent ${operation} and lock cannot invalidate a successful lock`, async () => {
			const id = `lock-${operation}`;
			await db.insert(schema.user).values({ id, username: id, passwordHash: 'fixture' });
			await db.insert(schema.modList).values({ id, owner: id, name: id, factorioVersion: '2.1' });
			await db.insert(schema.mod).values({
				id,
				modlist: id,
				name: 'example',
				enabled: operation !== 'moveToIcebox',
				icebox: false,
				essential: false,
				dependencies: '[]'
			});
			const [, locked] = await Promise.all([
				action(event(id, { modid: id, modId: id, modName: 'example' }) as ModEvent),
				toggleEssential(event(id, { modid: id }) as ModEvent)
			]);
			const row = (
				await client.execute({
					sql: 'SELECT enabled, essential, icebox FROM mod WHERE id = ?',
					args: [id]
				})
			).rows[0];
			if (!isActionFailure(locked)) {
				assert.ok(row, 'A successful lock must not be removed by a competing stale action');
				assert.equal(row.essential, 1);
				assert.equal(row.enabled, 1, 'A successfully locked mod must remain enabled');
			}
			if (row?.essential) {
				assert.equal(row.enabled, 1);
				assert.equal(row.icebox, 0, 'A locked mod must not be in the icebox');
			}
		});
	}
}
