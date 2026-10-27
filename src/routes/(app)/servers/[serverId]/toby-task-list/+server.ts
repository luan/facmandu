import { requireServer } from '#lib/server/servers.js';
import { tobyIntegrationArchive, tobyIntegrations } from '#lib/server/toby-integrations.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	return new Response(new Uint8Array(await tobyIntegrationArchive(server, 'TaskList')), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="TaskList_${tobyIntegrations.TaskList.version}.zip"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
