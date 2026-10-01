import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
	gameSettings,
	initializeServer,
	saveGameSettings,
	serverConfig,
	updateServerConfig
} from '../src/lib/server/server-files';
import { prepareStartupSave, uploadSave } from '../src/lib/server/server-saves';

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

test('startup resumes a complete newer autosave under the original name and respects explicit selections', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-resume-'));
	const server = {
		id: 'test',
		name: 'Test',
		directory,
		gamePort: 34197,
		rconPort: 27015,
		selectedModlist: null
	};
	const archive = (text: string) => zipSync({ 'world.txt': strToU8(text) });
	const put = async (name: string, contents: Uint8Array, modified: number) => {
		await writeFile(join(directory, 'saves', name), contents);
		await utimes(join(directory, 'saves', name), modified, modified);
	};
	try {
		await initializeServer(server);
		await put('world.zip', archive('original'), 100);
		await put('_autosave1.zip', archive('older progress'), 200);
		await put('_autosave2.zip', archive('latest progress'), 300);
		await updateServerConfig(server, { save: 'world.zip' });
		assert.equal(await prepareStartupSave(server), join(directory, 'saves/world.zip'));
		assert.deepEqual(
			await readFile(join(directory, 'saves/world.zip')),
			Buffer.from(archive('latest progress'))
		);
		assert.deepEqual(
			await readFile(join(directory, 'saves/_autosave2.zip')),
			Buffer.from(archive('latest progress'))
		);
		assert.equal((await serverConfig(server)).save, 'world.zip');
		await put('other.zip', archive('other world'), 50);
		await updateServerConfig(server, { save: 'other.zip', resumeAutosave: false });
		await prepareStartupSave(server);
		assert.deepEqual(
			await readFile(join(directory, 'saves/other.zip')),
			Buffer.from(archive('other world'))
		);
		await updateServerConfig(server, { resumeAutosave: true, autosaveAfter: 400000 });
		await prepareStartupSave(server);
		assert.deepEqual(
			await readFile(join(directory, 'saves/other.zip')),
			Buffer.from(archive('other world'))
		);
		await put('_autosave3.zip', archive('other world progress'), 500);
		await prepareStartupSave(server);
		assert.deepEqual(
			await readFile(join(directory, 'saves/other.zip')),
			Buffer.from(archive('other world progress'))
		);
		await put('other.zip', archive('safe world'), 600);
		await put('_autosave3.zip', new Uint8Array([80, 75, 3, 4]), 700);
		await assert.rejects(prepareStartupSave(server), /incomplete/);
		assert.deepEqual(
			await readFile(join(directory, 'saves/other.zip')),
			Buffer.from(archive('safe world'))
		);
		await updateServerConfig(server, { save: 'missing.zip' });
		await assert.rejects(prepareStartupSave(server), /Selected save not found/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
