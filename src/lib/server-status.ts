import type { ServerView } from '$lib/server/server-view';

// Watch only visible pages, with one request at a time and no work left after navigation.
export function watchServerStatus(
	serverId: string,
	accept: (status: ServerView['status']) => void,
	unavailable: () => void
) {
	const controller = new AbortController();
	let checking = false;
	async function check() {
		if (checking || document.visibilityState !== 'visible') return;
		checking = true;
		try {
			const response = await fetch(`/servers/${serverId}/status`, {
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
			});
			if (!response.ok) throw new Error('Server unavailable');
			const status: ServerView['status'] = await response.json();
			if (!controller.signal.aborted) accept(status);
		} catch {
			if (!controller.signal.aborted) unavailable();
		} finally {
			checking = false;
		}
	}
	void check();
	const timer = setInterval(() => {
		void check();
	}, 10_000);
	document.addEventListener('visibilitychange', check);
	return () => {
		controller.abort();
		clearInterval(timer);
		document.removeEventListener('visibilitychange', check);
	};
}
