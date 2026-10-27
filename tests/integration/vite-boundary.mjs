import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'facmandu-vite-'));
for (const name of [
	'DATABASE_URL',
	'TURSO_CONNECTION_URL',
	'TURSO_AUTH_TOKEN',
	'FACMANDU_REPLICA_PATH',
	'FACMANDU_AGENT_DATA',
	'FACMANDU_CACHE_DIR',
	'FACMANDU_SERVER_DIRECTORY',
	'FACMANDU_REVISION'
])
	delete process.env[name];
process.env.FACMANDU_DEV_ENV_DIR = directory;
await writeFile(
	join(directory, '.env'),
	[
		`DATABASE_URL=file:${join(directory, 'dev.db')}`,
		`FACMANDU_AGENT_DATA=${join(directory, 'agent')}`,
		`FACMANDU_CACHE_DIR=${join(directory, 'cache')}`,
		`FACMANDU_SERVER_DIRECTORY=${join(directory, 'servers')}`,
		'FACMANDU_REVISION=fixture-env-dir'
	].join('\n')
);

const server = await createServer({
	server: { port: 0, strictPort: false },
	logLevel: 'silent'
});
try {
	await server.listen();
	const address = server.httpServer?.address();
	assert.ok(address && typeof address !== 'string');
	const origin = `http://127.0.0.1:${address.port}`;
	for (const path of [
		'/Dockerfile',
		'/Dockerfile?import',
		'/Dockerfile?raw',
		'/%44ockerfile?import',
		`/@fs${process.cwd()}/Dockerfile?import`
	]) {
		assert.equal((await fetch(origin + path)).status, 403, path);
	}
	assert.equal((await fetch(`${origin}/@vite/client`)).status, 200);
	const health = await fetch(`${origin}/api/health`);
	assert.equal(health.status, 200);
	assert.deepEqual(await health.json(), { status: 'ok', revision: 'fixture-env-dir' });
} finally {
	await server.close();
	process.emit('sveltekit:shutdown');
	await rm(directory, { recursive: true, force: true });
}
console.info('Vite request boundary and isolated environment-directory checks passed.');
