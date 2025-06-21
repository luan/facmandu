import type { RequestHandler } from './$types';
import { addModlistListener } from '$lib/server/realtime';

const encoder = new TextEncoder();

export const GET: RequestHandler = ({ params }) => {
	const modlistId = params.id;
	if (!modlistId) {
		return new Response('modlist id required', { status: 400 });
	}

	const headers = new Headers({
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive'
	});

	let ping: ReturnType<typeof setInterval>;
	let unsubscribe: () => void;

	const stream = new ReadableStream({
		start(controller) {
			const send = (data: string) => {
				controller.enqueue(encoder.encode(`data: ${data}\n\n`));
			};

			unsubscribe = addModlistListener(modlistId, send);
			ping = setInterval(() => send('{"type":"ping"}'), 30000);
		},

		cancel() {
			clearInterval(ping);
			unsubscribe();
		}
	});

	return new Response(stream, { headers });
};
