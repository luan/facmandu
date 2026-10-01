// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { initializeServer, updateServerConfig } from '../src/lib/server/server-files';
import { completeSaveZip } from '../src/lib/server/server-saves';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('../src/lib/server/db', () => ({ db: {}, userHasModlistAccess: async () => false }));
const { backupSelectedSave, validatedSettingChanges } = await import(
	'../src/lib/server/server-agent-operations'
);

function reply(socket: Socket, id: number, type: number, body: string) {
	const data = Buffer.from(body);
	const frame = Buffer.alloc(data.length + 14);
	frame.writeInt32LE(data.length + 10, 0);
	frame.writeInt32LE(id, 4);
	frame.writeInt32LE(type, 8);
	data.copy(frame, 12);
	socket.write(frame);
}

async function saveRconFixture(directory: string) {
	const sockets = new Set<Socket>();
	const fixture = createServer((socket) => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
		let buffer = Buffer.alloc(0);
		socket.on('data', (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
				const length = buffer.readInt32LE(0);
				const id = buffer.readInt32LE(4);
				const type = buffer.readInt32LE(8);
				const command = buffer.toString('utf8', 12, length + 2);
				buffer = buffer.subarray(length + 4);
				if (type === 3) reply(socket, id, 2, '');
				else if (command.includes('facmandu-ready')) reply(socket, id, 0, 'facmandu-ready');
				else {
					const name = command.match(/game\.server_save\("([^"]+)"\)/u)?.[1];
					if (!name) throw new Error('Unexpected save command');
					void writeFile(
						join(directory, '.factorio', 'saves', `${name}.zip`),
						zipSync({ 'world.txt': strToU8('live world') })
					).then(() => reply(socket, id, 0, ''));
				}
			}
		});
	});
	await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
	const address = fixture.address();
	assert.ok(address && typeof address !== 'string');
	return {
		port: address.port,
		async close() {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => fixture.close(() => resolve()));
		}
	};
}

test('backup preserves the selected archive and never replaces a backup', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-backup-'));
	const previousPath = process.env.PATH;
	const server = {
		id: 'test',
		name: 'Test',
		directory,
		gamePort: 34197,
		rconPort: 27015,
		selectedModlist: null
	};
	let rcon: Awaited<ReturnType<typeof saveRconFixture>> | undefined;
	try {
		const systemctl = join(directory, 'systemctl');
		await writeFile(systemctl, '#!/bin/sh\nprintf "ActiveState=inactive\\nSubState=dead\\n"\n');
		await chmod(systemctl, 0o700);
		process.env.PATH = `${directory}:${previousPath ?? ''}`;
		await initializeServer(server);
		await writeFile(join(directory, 'saves', 'world.zip'), 'original world');
		await updateServerConfig(server, { save: 'world.zip' });
		assert.deepEqual(await backupSelectedSave(server, 'world-backup.zip'), {
			source: 'world.zip',
			backup: 'world-backup.zip'
		});
		assert.equal(
			await readFile(join(directory, 'saves', 'world-backup.zip'), 'utf8'),
			'original world'
		);
		await writeFile(join(directory, 'saves', 'world.zip'), 'later world');
		await assert.rejects(backupSelectedSave(server, 'world-backup.zip'), /already exists/);
		assert.equal(
			await readFile(join(directory, 'saves', 'world-backup.zip'), 'utf8'),
			'original world'
		);
		await assert.rejects(backupSelectedSave(server, '../outside.zip'), /Invalid save name/);
		rcon = await saveRconFixture(directory);
		server.rconPort = rcon.port;
		await writeFile(systemctl, '#!/bin/sh\nprintf "ActiveState=active\\nSubState=running\\n"\n');
		const live = await backupSelectedSave(server, 'live-copy.zip');
		assert.equal(live.backup, 'live-copy.zip');
		for (let attempt = 0; attempt < 40; attempt++) {
			if (await completeSaveZip(join(directory, 'saves', live.backup))) break;
			await new Promise((resolve) => setTimeout(resolve, 2));
		}
		assert.equal(await completeSaveZip(join(directory, 'saves', live.backup)), true);
		assert.equal(await readFile(join(directory, 'saves', 'world.zip'), 'utf8'), 'later world');
		assert.equal(await completeSaveZip(join(directory, 'saves', 'world-backup.zip')), false);
	} finally {
		await rcon?.close();
		process.env.PATH = previousPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test('setting changes preserve types and protect credentials', () => {
	const current = {
		name: 'Server',
		max_players: 10,
		visibility: { public: false, lan: true },
		password: 'secret',
		nested: { token: 'secret', label: 'private' }
	};
	assert.deepEqual(validatedSettingChanges(current, { max_players: 12, name: 'New name' }), {
		max_players: 12,
		name: 'New name'
	});
	assert.throws(() => validatedSettingChanges(current, { password: 'changed' }), /credentials/);
	assert.throws(
		() => validatedSettingChanges(current, { nested: { token: 'new' } }),
		/credentials/
	);
	assert.throws(() => validatedSettingChanges(current, { max_players: '12' }), /Invalid/);
	assert.throws(
		() => validatedSettingChanges(current, { visibility: { public: 'yes', lan: true } }),
		/Invalid/
	);
	assert.throws(
		() => validatedSettingChanges(current, { visibility: { public: true } }),
		/Invalid/
	);
	assert.deepEqual(validatedSettingChanges(current, { visibility: { public: true, lan: false } }), {
		visibility: { public: true, lan: false }
	});
	assert.throws(() => validatedSettingChanges(current, { unexpected: true }), /Unknown/);
	assert.throws(
		() => validatedSettingChanges(current, { max_players: Number.POSITIVE_INFINITY }),
		/JSON values/
	);
});
