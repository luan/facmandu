const encoder = new TextEncoder();
const streams = new Set<() => void>();
const closeStreams = () => {
	for (const close of streams) close();
};
process.once('SIGTERM', closeStreams);
process.once('SIGINT', closeStreams);
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		closeStreams();
		process.off('SIGTERM', closeStreams);
		process.off('SIGINT', closeStreams);
	});

// Every browser stream shares bounded buffering, permission rechecks, and shutdown cleanup.
export function eventStream(
	signal: AbortSignal,
	subscribe: (send: (event: string) => void, close: () => void) => () => void,
	maxAgeMs = 120_000
): Response {
	let cleanup = () => {};
	const body = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				let closed = false;
				let unsubscribe: (() => void) | undefined;
				const close = () => {
					if (closed) return;
					cleanup();
					controller.close();
				};
				const send = (event: string) => {
					if (closed) return;
					// Slow consumers reconnect and receive a current snapshot instead of accumulating output.
					if ((controller.desiredSize ?? 0) < 0) {
						close();
						return;
					}
					controller.enqueue(encoder.encode(event));
				};
				const heartbeat = setInterval(() => send(': heartbeat\n\n'), 15_000);
				const expiry = setTimeout(close, maxAgeMs);
				cleanup = () => {
					if (closed) return;
					closed = true;
					clearInterval(heartbeat);
					clearTimeout(expiry);
					signal.removeEventListener('abort', close);
					streams.delete(close);
					unsubscribe?.();
				};
				streams.add(close);
				signal.addEventListener('abort', close, { once: true });
				if (signal.aborted) {
					close();
					return;
				}
				send(': connected\n\n');
				try {
					unsubscribe = subscribe(send, close);
					if (closed) unsubscribe();
				} catch (cause) {
					cleanup();
					throw cause;
				}
			},
			cancel() {
				cleanup();
			}
		},
		new ByteLengthQueuingStrategy({ highWaterMark: 1024 * 1024 })
	);
	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'X-Accel-Buffering': 'no'
		}
	});
}
