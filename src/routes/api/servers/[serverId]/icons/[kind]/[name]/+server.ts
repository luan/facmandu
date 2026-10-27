import { error } from '@sveltejs/kit';
import {
	PrototypeIconsPending,
	prototypeIcon,
	validPrototypeIcon
} from '#lib/server/prototype-icons.js';
import { ServerError } from '#lib/server/server-files.js';
import { requireServer } from '#lib/server/servers.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in');
	const server = await requireServer(locals.user.id, params.serverId);
	const { kind, name } = params;
	if (!validPrototypeIcon(kind, name)) error(400, 'Invalid prototype icon');
	let png: Buffer | null;
	try {
		png = await prototypeIcon(server, kind, name, false);
	} catch (cause) {
		if (cause instanceof PrototypeIconsPending)
			return new Response(null, {
				status: 202,
				headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' }
			});
		if (cause instanceof ServerError && cause.status === 503)
			return new Response(cause.message, {
				status: 503,
				headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' }
			});
		if (cause instanceof ServerError) error(cause.status, cause.message);
		throw cause;
	}
	if (!png) error(404, 'Prototype icon not found');
	return new Response(new Uint8Array(png), {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'private, no-cache',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
