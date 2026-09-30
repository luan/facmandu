import { error } from '@sveltejs/kit';
import { prototypeIcon, validPrototypeIcon } from '$lib/server/prototype-icons';
import { ServerError } from '$lib/server/server-files';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in');
	const server = await requireServer(locals.user.id, params.serverId);
	const { kind, name } = params;
	if (!validPrototypeIcon(kind, name)) error(400, 'Invalid prototype icon');
	let png: Buffer | null;
	try {
		png = await prototypeIcon(server, kind, name);
	} catch (cause) {
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
