import { browser } from '$app/environment';

function getStorageKey(modlistId: string): string {
	return `rejected-recommendations:${modlistId}`;
}

function loadRejected(modlistId: string): Set<string> {
	if (!browser) return new Set();

	try {
		const key = getStorageKey(modlistId);
		const stored = localStorage.getItem(key);
		if (stored) {
			const parsed = JSON.parse(stored);
			return new Set(Array.isArray(parsed) ? parsed : []);
		}
	} catch (error) {
		console.error('Failed to load rejected recommendations:', error);
	}

	return new Set();
}

function saveRejected(modlistId: string, rejected: Set<string>): void {
	if (!browser) return;

	try {
		const key = getStorageKey(modlistId);
		localStorage.setItem(key, JSON.stringify(Array.from(rejected)));
	} catch (error) {
		console.error('Failed to save rejected recommendations:', error);
	}
}

export function createRejectedRecommendationsStore(modlistId: string) {
	let rejected = $state(loadRejected(modlistId));

	return {
		get rejected() {
			return rejected;
		},

		isRejected(modName: string): boolean {
			return rejected.has(modName);
		},

		reject(modName: string): void {
			if (!rejected.has(modName)) {
				rejected = new Set([...rejected, modName]);
				saveRejected(modlistId, rejected);
			}
		},

		unreject(modName: string): void {
			if (rejected.has(modName)) {
				const newRejected = new Set(rejected);
				newRejected.delete(modName);
				rejected = newRejected;
				saveRejected(modlistId, rejected);
			}
		},

		clear(): void {
			rejected = new Set();
			saveRejected(modlistId, rejected);
		}
	};
}
