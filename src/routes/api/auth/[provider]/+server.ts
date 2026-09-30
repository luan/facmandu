import { error } from '@sveltejs/kit';
import { codexAuthRoutes } from '$lib/server/codex';
import { copilotAuthRoutes } from '$lib/server/copilot';
import { metaAuthRoutes } from '$lib/server/meta';
import type { ProviderId } from '$lib/server/provider-auth';
import type { RequestHandler } from './$types';

const routes = {
	codex: codexAuthRoutes,
	meta: metaAuthRoutes,
	copilot: copilotAuthRoutes
} as const;

function providerRoutes(provider: string | undefined) {
	if (provider !== 'codex' && provider !== 'meta' && provider !== 'copilot')
		error(404, 'Unknown provider');
	return routes[provider as ProviderId];
}

export const GET: RequestHandler = (event) => providerRoutes(event.params.provider).GET(event);

export const POST: RequestHandler = (event) => providerRoutes(event.params.provider).POST(event);
