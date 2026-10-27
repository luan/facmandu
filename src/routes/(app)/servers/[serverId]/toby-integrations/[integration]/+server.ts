import { error } from '@sveltejs/kit';
import { requireServer } from '#lib/server/servers.js';
import { tobyIntegrationArchive, tobyIntegrations } from '#lib/server/toby-integrations.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	const name = params.integration;
	if (name !== 'TaskList' && name !== 'factoryplanner') error(404, 'Unknown Toby integration');
	return new Response(new Uint8Array(await tobyIntegrationArchive(server, name)), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}_${tobyIntegrations[name].version}.zip"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
