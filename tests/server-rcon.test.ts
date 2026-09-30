import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ManagedServer } from '../src/lib/server/db/schema';
import { rcon, rconScript } from '../src/lib/server/server-rcon';

function reply(socket: Socket, id: number, type: number, text: string) {
	const data = Buffer.from(text);
	const frame = Buffer.alloc(data.length + 14);
	frame.writeInt32LE(data.length + 10, 0);
	frame.writeInt32LE(id, 4);
	frame.writeInt32LE(type, 8);
	data.copy(frame, 12);
	// Exercise fragmented headers without a wall-clock delay.
	socket.write(frame.subarray(0, 2));
	socket.write(frame.subarray(2));
}

test('RCON initializes Lua once, reuses its connection, matches concurrent replies, and never replays a dropped command', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-rcon-'));
	const sockets = new Set<Socket>();
	let connections = 0;
	let probes = 0;
	const commands: string[] = [];
	const held = new Map<string, { socket: Socket; id: number }>();
	const fixture = createServer((socket) => {
		connections++;
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
		let buffer = Buffer.alloc(0);
		socket.on('data', (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
				const length = buffer.readInt32LE(0),
					id = buffer.readInt32LE(4),
					type = buffer.readInt32LE(8);
				const command = buffer.toString('utf8', 12, length + 2);
				buffer = buffer.subarray(length + 4);
				if (type === 3) {
					reply(socket, id, 2, '');
					continue;
				}
				commands.push(command);
				if (command.includes('facmandu-ready'))
					reply(socket, id, 0, ++probes === 1 ? '' : 'facmandu-ready\n');
				else if (command === 'first' || command === 'second') {
					held.set(command, { socket, id });
					const first = held.get('first');
					const second = held.get('second');
					if (first && second) {
						reply(second.socket, second.id, 0, 'two');
						reply(first.socket, first.id, 0, 'one');
					}
				} else if (command === 'disconnect') socket.destroy();
				else reply(socket, id, 0, 'result');
			}
		});
	});
	try {
		await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
		const address = fixture.address();
		assert.ok(address && typeof address !== 'string');
		await writeFile(
			join(directory, 'facmandu.json'),
			JSON.stringify({ rconPassword: 'test-password-is-long-enough' })
		);
		const server: ManagedServer = {
			id: 'rcon-test',
			name: 'Test',
			directory,
			gamePort: 34197,
			rconPort: address.port,
			selectedModlist: null
		};
		assert.deepEqual(
			await Promise.all([rconScript(server, 'lookup'), rconScript(server, 'lookup')]),
			['result', 'result']
		);
		assert.equal(probes, 2);
		assert.equal(connections, 1);
		assert.deepEqual(await Promise.all([rcon(server, 'first'), rcon(server, 'second')]), [
			'one',
			'two'
		]);
		await assert.rejects(rcon(server, 'disconnect'), /disconnected/u);
		assert.equal(commands.filter((command) => command === 'disconnect').length, 1);
		assert.equal(await rcon(server, 'after restart'), 'result');
		assert.equal(connections, 2);
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => fixture.close(() => resolve()));
		await rm(directory, { recursive: true, force: true });
	}
});
