// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.env.FACMANDU_INVENTORY_TEST_CHILD !== '1') {
	test('server mod inventory symlinks', async () => {
		const result = await promisify(execFile)(
			process.execPath,
			['test', fileURLToPath(import.meta.url)],
			{ env: { ...process.env, FACMANDU_INVENTORY_TEST_CHILD: '1' } }
		);
		assert.match(result.stdout + result.stderr, /0 fail/u);
	});
} else {
	// Keep dependency mocks out of other tests' real process and download modules.
	mock.module('../src/lib/server/server-process', () => ({
		executable: async () => null,
		requireStopped: async () => undefined
	}));
	mock.module('../src/lib/server/mod-downloads', () => ({ modArchive: async () => undefined }));
	mock.module('../src/lib/server/portal-cache', () => ({ getPortalMod: async () => undefined }));
	const { serverModInventory, installMod } = await import('../src/lib/server/server-mods');
	const { initializeServer } = await import('../src/lib/server/server-files');

	test('counts linked archives and protects linked development mods from replacement', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'facmandu-inventory-'));
		const server = {
			id: 'test',
			name: 'Test',
			directory,
			gamePort: 34197,
			rconPort: 27015,
			selectedModlist: null
		};
		try {
			await initializeServer(server);
			const development = join(directory, 'development');
			await mkdir(development);
			const info = JSON.stringify({ name: 'development', version: '1.0.0' });
			await writeFile(join(development, 'info.json'), info);
			await writeFile(join(development, 'data.lua'), '-- local development source\n');
			const linkedDirectory = join(directory, 'mods', 'development');
			await symlink(development, linkedDirectory, 'dir');
			const archive = join(directory, 'linked_1.0.0.zip');
			await writeFile(archive, 'linked archive fixture');
			await symlink(archive, join(directory, 'mods', 'linked_1.0.0.zip'), 'file');
			await mkdir(join(directory, 'downloads', 'mods'), { recursive: true });
			await symlink(archive, join(directory, 'downloads', 'mods', 'linked_1.0.0.zip'), 'file');
			await writeFile(join(directory, 'downloads', 'mods', 'development_2.0.0.zip'), 'replacement');
			const before = await readFile(join(directory, 'mods', 'mod-list.json'));

			const inventory = await serverModInventory(server);
			assert.deepEqual(inventory.installed[0]?.development, ['1.0.0']);
			assert.deepEqual(inventory.unpacked.development, ['1.0.0']);
			assert.deepEqual(inventory.installed[0]?.linked, ['1.0.0']);
			assert.deepEqual(inventory.available[0]?.linked, ['1.0.0']);
			await assert.rejects(installMod(server, 'development', '2.0.0'), {
				status: 409,
				message: 'Move the unpacked development mod before replacing its version'
			});
			assert.ok((await lstat(linkedDirectory)).isSymbolicLink());
			assert.equal(await readlink(linkedDirectory), development);
			assert.equal(await readFile(join(development, 'info.json'), 'utf8'), info);
			assert.equal(
				await readFile(join(development, 'data.lua'), 'utf8'),
				'-- local development source\n'
			);
			assert.deepEqual(await readFile(join(directory, 'mods', 'mod-list.json')), before);
			await assert.rejects(lstat(join(directory, 'mods', 'development_2.0.0.zip')), {
				code: 'ENOENT'
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}
