import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

test('Vite rejects Dockerfile requests before transformation while serving client modules', async () => {
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
	} finally {
		await server.close();
	}
});
