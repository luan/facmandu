import { error, json } from '@sveltejs/kit';
import { mapGenerationCatalog } from '$lib/server/map-generation-native';
import { ServerError } from '$lib/server/server-files';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in');
	const server = await requireServer(locals.user.id, params.serverId);
	try {
		return json(await mapGenerationCatalog(server));
	} catch (cause) {
		if (cause instanceof ServerError) error(cause.status, cause.message);
		throw cause;
	}
};
