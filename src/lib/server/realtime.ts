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
