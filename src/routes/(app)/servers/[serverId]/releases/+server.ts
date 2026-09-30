import { error, json } from '@sveltejs/kit';
import { factorioReleases } from '$lib/server/server-versions';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	await requireServer(locals.user?.id, params.serverId);
	try {
		return json(await factorioReleases(), {
			headers: { 'Cache-Control': 'private, max-age=60' }
		});
	} catch {
		error(502, 'Could not check Factorio releases. Installed versions are still available.');
	}
};
