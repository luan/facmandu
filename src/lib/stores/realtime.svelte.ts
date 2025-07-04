import { browser } from '$app/environment';

type RealtimeEventData = Record<string, unknown>;

type RealtimeEvent = {
	type:
		| 'modlist-updated'
		| 'mod-toggled'
		| 'mod-added'
		| 'mod-removed'
		| 'modlist-name-updated'
		| 'mod-essential-toggled'
		| 'icebox-added'
		| 'icebox-activated'
		| 'mod-moved-to-icebox';
	modlistId: string;
	data: RealtimeEventData;
	timestamp: number;
};

class RealtimeManager {
	private broadcastChannel: BroadcastChannel | null = null;
	private listeners: Map<string, Set<(data: RealtimeEventData) => void>> = new Map();
	private storageKey = 'factorio-manager-realtime';
	private eventQueue: RealtimeEvent[] = [];
	private batchTimeout: number | null = null;
	private readonly batchDelay = 100; // 100ms batching window

	constructor() {
		if (browser) {
			this.init();
		}
	}

	private init() {
		// Initialize Broadcast Channel API if supported
		if (typeof BroadcastChannel !== 'undefined') {
			this.broadcastChannel = new BroadcastChannel('factorio-manager-realtime');
			this.broadcastChannel.addEventListener('message', this.handleBroadcastMessage.bind(this));
		}

		// Listen for storage events as fallback
		if (typeof window !== 'undefined') {
			window.addEventListener('storage', this.handleStorageEvent.bind(this));
		}
	}

	private handleBroadcastMessage(event: MessageEvent<RealtimeEvent>) {
		this.processEvent(event.data);
	}

	private handleStorageEvent(event: StorageEvent) {
		if (event.key === this.storageKey && event.newValue) {
			try {
				const realtimeEvent: RealtimeEvent = JSON.parse(event.newValue);
				this.processEvent(realtimeEvent);
			} catch (error) {
				console.error('Failed to parse storage event:', error);
			}
		}
	}

	private processEvent(event: RealtimeEvent) {
		// Handle batched events
		if (event.data.batch && Array.isArray(event.data.events)) {
			event.data.events.forEach((eventData: RealtimeEventData) => {
				this.triggerListeners(event.type, event.modlistId, eventData);
			});
		} else {
			this.triggerListeners(event.type, event.modlistId, event.data);
		}
	}

	private triggerListeners(eventType: string, modlistId: string, data: RealtimeEventData) {
		const eventListeners = this.listeners.get(eventType);
		if (eventListeners) {
			eventListeners.forEach((listener) => listener(data));
		}

		// Also trigger modlist-specific listeners
		const modlistListeners = this.listeners.get(`${eventType}:${modlistId}`);
		if (modlistListeners) {
			modlistListeners.forEach((listener) => listener(data));
		}
	}

	public subscribe(eventType: string, listener: (data: RealtimeEventData) => void) {
		if (!this.listeners.has(eventType)) {
			this.listeners.set(eventType, new Set());
		}
		this.listeners.get(eventType)!.add(listener);

		// Return unsubscribe function
		return () => {
			const listeners = this.listeners.get(eventType);
			if (listeners) {
				listeners.delete(listener);
				if (listeners.size === 0) {
					this.listeners.delete(eventType);
				}
			}
		};
	}

	public broadcast(event: Omit<RealtimeEvent, 'timestamp'>) {
		const realtimeEvent: RealtimeEvent = {
			...event,
			timestamp: Date.now()
		};

		// Add to batch queue for optimization
		this.eventQueue.push(realtimeEvent);

		// Clear existing timeout and set new one
		if (this.batchTimeout) {
			clearTimeout(this.batchTimeout);
		}

		this.batchTimeout = window.setTimeout(() => {
			this.flushEventQueue();
		}, this.batchDelay);
	}

	private flushEventQueue() {
		if (this.eventQueue.length === 0) return;

		// Process events in batch
		const eventsToProcess = [...this.eventQueue];
		this.eventQueue = [];
		this.batchTimeout = null;

		// Group events by type and modlist for efficient processing
		const eventGroups = new Map<string, RealtimeEvent[]>();
		
		eventsToProcess.forEach(event => {
			const key = `${event.type}:${event.modlistId}`;
			if (!eventGroups.has(key)) {
				eventGroups.set(key, []);
			}
			eventGroups.get(key)!.push(event);
		});

		// Send batched events
		eventGroups.forEach((events, key) => {
			if (events.length === 1) {
				// Single event - send as normal
				this.sendEvent(events[0]);
			} else {
				// Multiple events of same type - send as batch
				this.sendBatchedEvent(events);
			}
		});
	}

	private sendEvent(event: RealtimeEvent) {
		// Broadcast via Broadcast Channel API
		if (this.broadcastChannel) {
			this.broadcastChannel.postMessage(event);
		}

		// Fallback to localStorage for older browsers
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(this.storageKey, JSON.stringify(event));
			// Clear the storage immediately to allow repeated events
			setTimeout(() => {
				try {
					localStorage.removeItem(this.storageKey);
				} catch {
					// Ignore errors when clearing storage
				}
			}, 100);
		}
	}

	private sendBatchedEvent(events: RealtimeEvent[]) {
		const batchEvent: RealtimeEvent = {
			type: events[0].type,
			modlistId: events[0].modlistId,
			data: {
				batch: true,
				events: events.map(e => e.data)
			},
			timestamp: Date.now()
		};

		this.sendEvent(batchEvent);
	}

	public destroy() {
		// Clear any pending batch timeout
		if (this.batchTimeout) {
			clearTimeout(this.batchTimeout);
			this.batchTimeout = null;
		}
		
		// Flush any remaining events
		this.flushEventQueue();
		
		if (this.broadcastChannel) {
			this.broadcastChannel.close();
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('storage', this.handleStorageEvent.bind(this));
		}
		this.listeners.clear();
	}
}

export const realtimeManager = new RealtimeManager();

// Convenience functions for common operations
export function subscribeToModlistUpdates(
	modlistId: string,
	callback: (data: RealtimeEventData) => void
) {
	const unsubscribeFunctions = [
		realtimeManager.subscribe(`modlist-updated:${modlistId}`, callback),
		realtimeManager.subscribe(`mod-toggled:${modlistId}`, callback),
		realtimeManager.subscribe(`mod-added:${modlistId}`, callback),
		realtimeManager.subscribe(`mod-removed:${modlistId}`, callback),
		realtimeManager.subscribe(`modlist-name-updated:${modlistId}`, callback)
	];

	return () => {
		unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
	};
}

export function broadcastModToggled(modlistId: string, modId: string, enabled: boolean) {
	realtimeManager.broadcast({
		type: 'mod-toggled',
		modlistId,
		data: { modId, enabled }
	});
}

export function broadcastModAdded(modlistId: string, mod: RealtimeEventData) {
	realtimeManager.broadcast({
		type: 'mod-added',
		modlistId,
		data: { mod }
	});
}

export function broadcastModRemoved(modlistId: string, modName: string) {
	realtimeManager.broadcast({
		type: 'mod-removed',
		modlistId,
		data: { modName }
	});
}

export function broadcastModlistNameUpdated(modlistId: string, name: string) {
	realtimeManager.broadcast({
		type: 'modlist-name-updated',
		modlistId,
		data: { name }
	});
}

export function broadcastModlistUpdated(modlistId: string, mods: RealtimeEventData[]) {
	realtimeManager.broadcast({
		type: 'modlist-updated',
		modlistId,
		data: { mods }
	});
}
