import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { renderFactoryBlueprint } from '$lib/server/factory-images';
import { ServerError } from '$lib/server/server-files';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Sign in');
	const server = await requireServer(locals.user.id, params.serverId);
	const body = z
		.strictObject({ blueprint: z.string().max(256000) })
		.safeParse(await request.json());
	if (!body.success) error(400, 'Invalid blueprint');
	try {
		return json(await renderFactoryBlueprint(server, body.data.blueprint));
	} catch (cause) {
		if (cause instanceof ServerError) error(cause.status, cause.message);
		throw cause;
	}
};
