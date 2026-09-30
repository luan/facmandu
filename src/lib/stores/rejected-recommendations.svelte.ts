import { toast } from 'svelte-sonner';
import { browser } from '$app/environment';

export function createRejectedRecommendationsStore(modlistId: string) {
	let rejected = $state(new Set<string>());
	let loaded = $state(false);
	let pending = $state(false);
	let loading: Promise<void> | undefined;
	const endpoint = `/api/modlists/${modlistId}/recommendations`;
	async function save(names: string[], dismissed: boolean) {
		const response = await fetch(endpoint, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ names, dismissed })
		});
		if (!response.ok) throw new Error('Could not save recommendation preferences');
	}
	function load(refresh = false) {
		if (!browser || (loaded && !refresh)) return;
		if (loading !== undefined) return loading;
		loading = (async () => {
			try {
				const response = await fetch(endpoint);
				if (!response.ok) throw new Error('Could not load recommendation preferences');
				const data: { dismissed: string[] } = await response.json();
				rejected = new Set(data.dismissed);
				// Import the previous browser-only preferences once, after authentication.
				const legacyKey = `rejected-recommendations:${modlistId}`;
				let legacy: unknown;
				try {
					legacy = JSON.parse(localStorage.getItem(legacyKey) ?? 'null');
				} catch {
					legacy = null;
				}
				if (Array.isArray(legacy)) {
					const names = legacy
						.filter((name): name is string => typeof name === 'string')
						.slice(0, 1000);
					if (names.length) {
						await save(names, true);
						rejected = new Set([...rejected, ...names]);
					}
					localStorage.removeItem(legacyKey);
				}
				loaded = true;
			} catch (cause) {
				toast.error(
					cause instanceof Error ? cause.message : 'Could not load recommendation preferences'
				);
			} finally {
				loading = undefined;
			}
		})();
		return loading;
	}
	async function change(name: string, dismissed: boolean) {
		if (pending) return;
		pending = true;
		const previous = rejected;
		rejected = new Set(rejected);
		if (dismissed) rejected.add(name);
		else rejected.delete(name);
		try {
			await save([name], dismissed);
		} catch (cause) {
			rejected = previous;
			toast.error(
				cause instanceof Error ? cause.message : 'Could not save recommendation preferences'
			);
		} finally {
			pending = false;
		}
	}
	return {
		get rejected() {
			return rejected;
		},
		get loaded() {
			return loaded;
		},
		get pending() {
			return pending;
		},
		load,
		isRejected: (name: string) => rejected.has(name),
		reject: (name: string) => change(name, true),
		unreject: (name: string) => change(name, false)
	};
}
