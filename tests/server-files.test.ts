import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	gameSettings,
	initializeServer,
	saveGameSettings,
	serverConfig,
	updateServerConfig
} from '../src/lib/server/server-files';
import { uploadSave } from '../src/lib/server/server-saves';

test('instance files preserve credentials and independent selections', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-files-'));
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
		const original = await serverConfig(server);
		await updateServerConfig(server, { save: 'world.zip' });
		assert.equal((await serverConfig(server)).rconPassword, original.rconPassword);
		await assert.rejects(updateServerConfig(server, { save: '../world.zip' }));
		await saveGameSettings(server, { token: 'private', visibility: { public: false, lan: true } });
		await saveGameSettings(server, { max_players: 12 });
		assert.equal((await gameSettings(server)).token, 'private');
		assert.deepEqual((await gameSettings(server)).visibility, { public: false, lan: true });
		await writeFile(
			join(directory, 'mods', 'mod-list.json'),
			JSON.stringify({
				mods: [
					{ name: 'base', enabled: true },
					{ name: 'example', enabled: true }
				]
			})
		);
		await rm(join(directory, 'config', 'server-whitelist.json'));
		await initializeServer(server);
		assert.equal((await serverConfig(server)).save, 'world.zip');
		assert.equal((await gameSettings(server)).token, 'private');
		assert.equal((await serverConfig(server)).rconPassword, original.rconPassword);
		assert.match(await readFile(join(directory, 'mods', 'mod-list.json'), 'utf8'), /example/);
		assert.deepEqual(
			JSON.parse(await readFile(join(directory, 'config', 'server-whitelist.json'), 'utf8')),
			[]
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('save uploads reject paths and never overwrite an existing save', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-saves-'));
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
		const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
		const file = new File([bytes], 'world.zip');
		await uploadSave(server, file);
		await assert.rejects(uploadSave(server, file), /already exists/);
		await assert.rejects(
			uploadSave(server, new File([bytes], '../outside.zip')),
			/Invalid save name/
		);
		await assert.rejects(uploadSave(server, new File(['not a zip'], 'bad.zip')), /ZIP/);
		assert.deepEqual(new Uint8Array(await readFile(join(directory, 'saves/world.zip'))), bytes);
		assert.deepEqual(await readdir(join(directory, 'saves')), ['world.zip']);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
