import { connect } from 'node:net';
import type { ManagedServer } from './db/schema';
import { serverConfig } from './server-files';

function packet(id: number, type: number, text: string) {
	const data = Buffer.from(text, 'utf8');
	const buffer = Buffer.alloc(data.length + 14);
	buffer.writeInt32LE(data.length + 10, 0);
	buffer.writeInt32LE(id, 4);
	buffer.writeInt32LE(type, 8);
	data.copy(buffer, 12);
	return buffer;
}

// Keep one authenticated connection per instance. Request IDs isolate concurrent
// replies; a dropped connection fails requests without replaying game commands.
function connection(port: number, password: string) {
	const socket = connect({ host: '127.0.0.1', port });
	const authenticated = Promise.withResolvers<void>();
	const pending = new Map<
		number,
		{
			resolve: (value: string) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	let buffer = Buffer.alloc(0);
	let nextId = 2;
	let closed = false;
	let prepared: Promise<void> | undefined;
	const authTimer = setTimeout(() => close(new Error('RCON authentication timed out')), 8000);
	function close(error = new Error('RCON disconnected')) {
		if (closed) return;
		closed = true;
		clearTimeout(authTimer);
		authenticated.reject(error);
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		pending.clear();
		socket.destroy();
	}
	socket.setTimeout(30_000, () => close());
	socket.on('error', () => close(new Error('Could not connect to RCON')));
	socket.on('close', () => close());
	socket.on('connect', () => socket.write(packet(1, 3, password)));
	socket.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (buffer.length >= 4) {
			const length = buffer.readInt32LE(0);
			if (length < 10 || length > 256 * 1024) {
				close(new Error('Invalid RCON response'));
				return;
			}
			if (buffer.length < length + 4) return;
			const id = buffer.readInt32LE(4),
				type = buffer.readInt32LE(8);
			const body = buffer.toString('utf8', 12, length + 2);
			buffer = buffer.subarray(length + 4);
			if (id === -1) {
				close(new Error('RCON authentication failed'));
				return;
			}
			if (id === 1 && type === 2) {
				clearTimeout(authTimer);
				authenticated.resolve();
			} else {
				const request = pending.get(id);
				if (!request) continue;
				// Factorio sends one complete response frame per command.
				pending.delete(id);
				clearTimeout(request.timer);
				request.resolve(body);
			}
		}
	});
	async function query(command: string) {
		await authenticated.promise;
		if (closed) throw new Error('RCON disconnected');
		const id = nextId++;
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => close(new Error('RCON timed out')), 8000);
			pending.set(id, { resolve, reject, timer });
			socket.write(packet(id, 2, command));
		});
	}
	async function script(command: string) {
		prepared ??= (async () => {
			// A fresh save rejects its first Lua command and echoes the source in
			// the log. Confirm with this tiny read-only probe before sending a bundle.
			const probe = '/silent-command rcon.print("facmandu-ready")';
			let reply = await query(probe);
			if (!reply.trim()) reply = await query(probe);
			if (reply.trim() !== 'facmandu-ready')
				throw new Error('Factorio did not enable factory queries');
		})();
		await prepared;
		return query(command);
	}
	return {
		port,
		password,
		get closed() {
			return closed;
		},
		query,
		script,
		close
	};
}
const connections = new Map<string, ReturnType<typeof connection>>();
async function client(server: ManagedServer) {
	const config = await serverConfig(server);
	let current = connections.get(server.id);
	if (
		!current ||
		current.closed ||
		current.port !== server.rconPort ||
		current.password !== config.rconPassword
	) {
		current?.close();
		current = connection(server.rconPort, config.rconPassword);
		connections.set(server.id, current);
	}
	return current;
}
export async function rcon(server: ManagedServer, command: string) {
	return (await client(server)).query(command);
}
export async function rconScript(server: ManagedServer, command: string) {
	return (await client(server)).script(command);
}
process.once('sveltekit:shutdown', () => {
	for (const current of connections.values()) current.close();
	connections.clear();
});
