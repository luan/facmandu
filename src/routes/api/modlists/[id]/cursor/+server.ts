import type { RequestHandler } from './$types';
import { publishModlistEvent } from '$lib/server/realtime';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	// Ensure user is authenticated
	if (!locals.user) {
		return new Response('unauthorized', { status: 401 });
	}

	const modlistId = params.id;
	if (!modlistId) {
		return new Response('modlist id required', { status: 400 });
	}

	let x: unknown;
	let y: unknown;

	try {
		({ x, y } = await request.json());
	} catch {
		return new Response('invalid json', { status: 400 });
	}

	if (typeof x !== 'number' || typeof y !== 'number') {
		return new Response('invalid coordinates', { status: 400 });
	}

	// Clamp values to viewport range just in case
	const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
	const payload = {
		userId: locals.user.id,
		username: locals.user.username,
		x: clamp(x as number),
		y: clamp(y as number)
	};

	publishModlistEvent(modlistId, 'cursor', payload);

	return new Response(null, { status: 204 });
};
