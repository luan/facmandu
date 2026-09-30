import { json } from '@sveltejs/kit';
import { loadServerView } from '$lib/server/server-view';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	const requestedTab = url.searchParams.get('tab');
	const tab = !requestedTab || requestedTab === 'overview' ? 'console' : requestedTab;
	if (!['mods', 'saves', 'settings', 'access', 'console'].includes(tab))
		return new Response('Unknown server section', { status: 400 });
	return json(
		await loadServerView(
			server,
			locals.user?.id ?? '',
			tab,
			url.searchParams.get('list') ?? server.selectedModlist
		)
	);
};
