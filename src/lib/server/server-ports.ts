import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { db } from './db';
import { managedServer } from './db/schema';

async function portAvailable(port: number, protocol: 'udp' | 'tcp'): Promise<boolean> {
	return await new Promise((resolve) => {
		if (protocol === 'udp') {
			const socket = createSocket('udp4');
			socket.once('error', () => {
				socket.close();
				resolve(false);
			});
			socket.bind(port, '0.0.0.0', () => socket.close(() => resolve(true)));
		} else {
			const socket = createServer();
			socket.once('error', () => resolve(false));
			socket.listen(port, '127.0.0.1', () => socket.close(() => resolve(true)));
		}
	});
}
export async function allocateServerPorts(requested: { gamePort?: number; rconPort?: number }) {
	const servers = await db
		.select({ gamePort: managedServer.gamePort, rconPort: managedServer.rconPort })
		.from(managedServer);
	const reserved = new Set(servers.flatMap((server) => [server.gamePort, server.rconPort]));
	async function choose(requestedPort: number | undefined, start: number, protocol: 'udp' | 'tcp') {
		for (let port = requestedPort ?? start; port <= 65535; port++) {
			if (!reserved.has(port) && (await portAvailable(port, protocol))) {
				reserved.add(port);
				return port;
			}
			if (requestedPort) throw new Error(`Port ${requestedPort} is already in use`);
		}
		throw new Error('No available ports');
	}
	const rconPort = requested.rconPort ? await choose(requested.rconPort, 27015, 'tcp') : undefined;
	const gamePort = await choose(requested.gamePort, 34197, 'udp');
	return { gamePort, rconPort: rconPort ?? (await choose(undefined, 27015, 'tcp')) };
}
