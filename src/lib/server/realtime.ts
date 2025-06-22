import { EventEmitter } from 'events';

// Ensure a single instance across hot reloads (important for dev)
type GlobalWithEmitter = typeof global & {
	__modlistRealtimeEmitter__?: EventEmitter;
};

// Cast global to extended type to store a singleton emitter across reloads
const globalWithEmitter = global as GlobalWithEmitter;

function getEmitter(): EventEmitter {
	const globalKey = '__modlistRealtimeEmitter__';
	if (!globalWithEmitter[globalKey]) {
		globalWithEmitter[globalKey] = new EventEmitter();
	}
	return globalWithEmitter[globalKey];
}

export interface ModlistServerEvent {
	type: string;
	data?: unknown;
	timestamp: number;
}

export function publishModlistEvent(modlistId: string, type: string, data: unknown = {}): void {
	const payload: ModlistServerEvent = { type, data, timestamp: Date.now() };
	getEmitter().emit(modlistId, JSON.stringify(payload));
}

export function addModlistListener(
	modlistId: string,
	listener: (payload: string) => void
): () => void {
	getEmitter().on(modlistId, listener);
	return () => getEmitter().off(modlistId, listener);
}

// PRESENCE MANAGEMENT START
// track active viewers per modlist
interface PresenceInfo {
	username: string;
	count: number;
}

const activeViewers: Map<string, Map<string, PresenceInfo>> = new Map();

function broadcastPresence(modlistId: string) {
	const viewers = Array.from(activeViewers.get(modlistId)?.entries() ?? []).map(([id, info]) => ({
		id,
		username: info.username
	}));
	publishModlistEvent(modlistId, 'presence-update', { viewers });
}

export function addActiveViewer(modlistId: string, userId: string, username: string): () => void {
	let users = activeViewers.get(modlistId);
	if (!users) {
		users = new Map();
		activeViewers.set(modlistId, users);
	}
	const existing = users.get(userId);
	if (existing) {
		existing.count += 1;
	} else {
		users.set(userId, { username, count: 1 });
	}
	broadcastPresence(modlistId);

	return () => {
		const set = activeViewers.get(modlistId);
		if (!set) return;
		const info = set.get(userId);
		if (!info) return;
		if (info.count <= 1) {
			set.delete(userId);
		} else {
			info.count -= 1;
		}
		if (set.size === 0) {
			activeViewers.delete(modlistId);
		}
		broadcastPresence(modlistId);
	};
}

export function getActiveViewers(modlistId: string) {
	return Array.from(activeViewers.get(modlistId)?.entries() ?? []).map(([id, info]) => ({
		id,
		username: info.username
	}));
}
// PRESENCE MANAGEMENT END
