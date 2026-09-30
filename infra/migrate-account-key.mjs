// Run once with Bun and the application's environment loaded. Never prints credentials.
// bun --env-file=/path/to/app.env infra/migrate-account-key.mjs /path/to/app.env
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { migrate } from '../src/lib/server/db/migrate.ts';

const envFile = process.argv[2];
if (!envFile) throw new Error('Pass the application environment file to remove the migrated key');
const apiKey = process.env.FACMANDU_TYPESAFE_API_KEY || process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error('No global TypeSafe key is configured; nothing was changed');
const client = createClient({
	url: process.env.TURSO_CONNECTION_URL || process.env.DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN
});
try {
	await migrate(
		client,
		await readFile(new URL('../src/lib/server/db/initial.sql', import.meta.url), 'utf8')
	);
	const tx = await client.transaction('write');
	try {
		const account = (
			await tx.execute("SELECT id, typesafe_api_key FROM user WHERE username = 'luan'")
		).rows[0];
		if (!account) throw new Error('The existing luan account was not found');
		if (account.typesafe_api_key && account.typesafe_api_key !== apiKey)
			throw new Error('luan already has a different account key; no key was overwritten');
		await tx.execute({
			sql: 'UPDATE user SET typesafe_api_key = ? WHERE id = ?',
			args: [apiKey, account.id]
		});
		await tx.commit();
	} catch (cause) {
		await tx.rollback();
		throw cause;
	} finally {
		tx.close();
	}
	const saved = (await client.execute("SELECT typesafe_api_key FROM user WHERE username = 'luan'"))
		.rows[0];
	if (saved?.typesafe_api_key !== apiKey)
		throw new Error('Key verification failed; the global key was retained');
	const original = await readFile(envFile, 'utf8');
	const cleaned = original
		.split('\n')
		.filter(
			(line) => !/^\s*(?:export\s+)?(?:FACMANDU_TYPESAFE_API_KEY|TYPESAFE_API_KEY)\s*=/u.test(line)
		)
		.join('\n');
	const temporary = `${envFile}.account-migration`;
	await writeFile(temporary, cleaned, { mode: 0o600 });
	await rename(temporary, envFile);
	console.info(
		'Verified luan account key; removed global TypeSafe keys from the application environment.'
	);
	const admins = await client.execute('SELECT username FROM user WHERE is_admin = 1');
	console.info('Administrators:', admins.rows.map((row) => row.username).join(', '));
} finally {
	client.close();
}
