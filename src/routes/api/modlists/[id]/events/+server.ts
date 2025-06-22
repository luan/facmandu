import type { RequestHandler } from './$types';
import { addModlistListener, addActiveViewer, getActiveViewers } from '$lib/server/realtime';
import { sessionCookieName, validateSessionToken } from '$lib/server/auth';

const encoder = new TextEncoder();

export const GET: RequestHandler = async ({ params, cookies: kitCookies }) => {
	const modlistId = params.id;
	if (!modlistId) {
		return new Response('modlist id required', { status: 400 });
	}

	// Identify user (may be anonymous)
	const token = kitCookies.get(sessionCookieName);
	let userId = 'anon';
	let username = 'Anonymous';
	if (token) {
		try {
			const { user } = await validateSessionToken(token);
			if (user) {
				userId = user.id;
				username = user.username;
			}
		} catch {
			// ignore validation errors
		}
	}

	const headers = new Headers({
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive'
	});

	let ping: ReturnType<typeof setInterval>;
	let unsubscribe: () => void;
	let removePresence: () => void;

	const stream = new ReadableStream({
		start(controller) {
			const send = (data: string) => {
				controller.enqueue(encoder.encode(`data: ${data}\n\n`));
			};

			// Presence management
			removePresence = addActiveViewer(modlistId, userId, username);

			// Send current viewers immediately
			send(
				JSON.stringify({ type: 'presence-init', data: { viewers: getActiveViewers(modlistId) } })
			);

			unsubscribe = addModlistListener(modlistId, send);
			ping = setInterval(() => send('{"type":"ping"}'), 30000);
		},

		cancel() {
			clearInterval(ping);
			unsubscribe();
			removePresence?.();
		}
	});

	return new Response(stream, { headers });
};
