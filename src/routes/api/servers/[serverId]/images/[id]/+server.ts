import { error } from '@sveltejs/kit';
import { factoryImageRendering, readFactoryImage } from '#lib/server/factory-images.js';
import { ServerError } from '#lib/server/server-files.js';
import { requireServer } from '#lib/server/servers.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in');
	const server = await requireServer(locals.user.id, params.serverId);
	try {
		const png = await readFactoryImage(server, params.id);
		return new Response(new Uint8Array(png), {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'private, no-cache',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (cause) {
		if (cause instanceof ServerError) error(cause.status, cause.message);
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
			error(
				factoryImageRendering(server.id, params.id) ? 425 : 404,
				'Factory image is preparing or unavailable'
			);
		throw cause;
	}
};
