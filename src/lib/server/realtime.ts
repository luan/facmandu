import { EventEmitter } from 'events';

// Ensure a single instance across hot reloads (important for dev)
const getEmitter = (): EventEmitter => {
	const globalKey = '__modlistRealtimeEmitter__';
	// @ts-ignore
	const globalAny = global as any;
	if (!globalAny[globalKey]) {
		globalAny[globalKey] = new EventEmitter();
	}
	return globalAny[globalKey] as EventEmitter;
};

const emitter = getEmitter();

export interface ModlistServerEvent {
	type: string;
	data?: any;
	timestamp: number;
}

export function publishModlistEvent(modlistId: string, type: string, data: any = {}): void {
	const payload: ModlistServerEvent = { type, data, timestamp: Date.now() };
	emitter.emit(modlistId, JSON.stringify(payload));
}

export function addModlistListener(
	modlistId: string,
	listener: (payload: string) => void
): () => void {
	emitter.on(modlistId, listener);
	return () => emitter.off(modlistId, listener);
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
