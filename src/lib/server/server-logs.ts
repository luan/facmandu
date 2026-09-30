import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { boundedConsoleLines, consoleText } from '$lib/console';
import type { ManagedServer } from './db/schema';
export type LogLine = { id: string; text: string; time: number | null };
export type LogPacket =
	| { type: 'lines'; lines: LogLine[] }
	| { type: 'connection'; state: 'connecting' | 'live' | 'reconnecting' };
type Hub = {
	listeners: Set<(packet: LogPacket) => void>;
	lines: LogLine[];
	timer: ReturnType<typeof setInterval>;
	close: () => void;
};
const hubs = new Map<string, Hub>();
export function resetServerLogs(id: string) {
	hubs.get(id)?.close();
	hubs.delete(id);
}
export function subscribeLogs(server: ManagedServer, listener: (packet: LogPacket) => void) {
	let hub = hubs.get(server.id);
	if (!hub) {
		let offset = 0,
			inode = 0,
			reading = false,
			closed = false,
			partial = '';
		let decoder = new StringDecoder('utf8');
		const listeners = new Set<(packet: LogPacket) => void>();
		const publish = (packet: LogPacket) => {
			for (const notify of listeners) notify(packet);
		};
		const poll = async () => {
			if (reading || closed) return;
			reading = true;
			try {
				const path = join(server.directory, 'logs', 'server.log');
				const file = await stat(path).catch(() => null);
				if (!file) {
					publish({ type: 'connection', state: 'live' });
					return;
				}
				let skipPartial = false;
				if (file.ino !== inode || file.size < offset) {
					inode = file.ino;
					offset = Math.max(0, file.size - 256 * 1024);
					partial = '';
					decoder = new StringDecoder('utf8');
					skipPartial = offset > 0;
				}
				if (file.size > offset) {
					const handle = await open(path, 'r');
					let bytes: Buffer;
					try {
						const buffer = Buffer.alloc(Math.min(file.size - offset, 256 * 1024));
						const read = await handle.read(buffer, 0, buffer.length, offset);
						offset += read.bytesRead;
						bytes = buffer.subarray(0, read.bytesRead);
					} finally {
						await handle.close();
					}
					let lineOffset = offset - bytes.length - Buffer.byteLength(partial);
					const parts = (partial + decoder.write(bytes)).split('\n');
					partial = (parts.pop() ?? '').slice(-256 * 1024);
					if (skipPartial) lineOffset += Buffer.byteLength(parts.shift() ?? '') + 1;
					const lines = parts.map((text) => {
						const id = `${inode}:${lineOffset}`;
						lineOffset += Buffer.byteLength(text) + 1;
						return { id, text: consoleText(text), time: null };
					});
					if (lines.length && !closed) {
						current.lines = boundedConsoleLines([...current.lines, ...lines]);
						publish({ type: 'lines', lines: boundedConsoleLines(lines) });
					}
				}
				publish({ type: 'connection', state: 'live' });
			} catch {
				if (!closed) publish({ type: 'connection', state: 'reconnecting' });
			} finally {
				reading = false;
			}
		};
		const timer = setInterval(() => void poll(), 1000);
		const current: Hub = {
			listeners,
			lines: [],
			timer,
			close: () => {
				closed = true;
				clearInterval(timer);
			}
		};
		hub = current;
		hubs.set(server.id, current);
		void poll();
	}
	hub.listeners.add(listener);
	listener({ type: 'connection', state: 'connecting' });
	if (hub.lines.length) listener({ type: 'lines', lines: hub.lines });
	return () => {
		hub.listeners.delete(listener);
		if (!hub.listeners.size) resetServerLogs(server.id);
	};
}
process.once('sveltekit:shutdown', () => {
	for (const id of hubs.keys()) resetServerLogs(id);
});
