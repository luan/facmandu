import { json } from '@sveltejs/kit';
import { serverStatus } from '$lib/server/server-process';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, locals }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	try {
		return json(await serverStatus(server));
	} catch {
		return json({ error: 'Could not read server status' }, { status: 502 });
	}
};
