import { error } from '@sveltejs/kit';
import { codexAuthRoutes } from '#lib/server/codex.js';
import { copilotAuthRoutes } from '#lib/server/copilot.js';
import { metaAuthRoutes } from '#lib/server/meta.js';
import type { ProviderId } from '#lib/server/provider-auth.js';
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
