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
	let scroll: unknown;
	let view: unknown;
	let targetId: unknown;
	let rx: unknown;
	let ry: unknown;

	try {
		({ x, y, scroll, view, targetId, rx, ry } = await request.json());
	} catch {
		return new Response('invalid json', { status: 400 });
	}

	if (
		typeof x !== 'number' ||
		typeof y !== 'number' ||
		typeof scroll !== 'number' ||
		typeof view !== 'number'
	) {
		return new Response('invalid coordinates', { status: 400 });
	}

	// Clamp values to viewport range just in case
	const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
	const payload: Record<string, unknown> = {
		userId: locals.user.id,
		username: locals.user.username,
		x: clamp(x as number),
		y: clamp(y as number),
		scroll: clamp(scroll as number),
		view: clamp(view as number)
	};

	if (typeof targetId === 'string') {
		payload.targetId = targetId;
		if (typeof rx === 'number') payload.rx = clamp(rx);
		if (typeof ry === 'number') payload.ry = clamp(ry);
	}

	publishModlistEvent(modlistId, 'cursor', payload);

	return new Response(null, { status: 204 });
};
