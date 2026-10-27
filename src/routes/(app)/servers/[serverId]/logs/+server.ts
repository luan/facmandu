import { eventStream } from '#lib/server/event-stream.js';
import { subscribeLogs } from '#lib/server/server-logs.js';
import { requireServer } from '#lib/server/servers.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	return eventStream(
		request.signal,
		(send) => subscribeLogs(server, (packet) => send(`data: ${JSON.stringify(packet)}\n\n`)),
		5 * 60_000
	);
};
