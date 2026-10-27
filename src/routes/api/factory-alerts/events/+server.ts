import { error } from '@sveltejs/kit';
import { eventStream } from '#lib/server/event-stream.js';
import { subscribeFactoryAlerts } from '#lib/server/factory-watches.js';
import { canManageServer } from '#lib/server/servers.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, request }) => {
	const userId = locals.user?.id;
	if (!userId) error(401, 'Sign in');
	if (!canManageServer(userId)) error(403, 'Server management is restricted');
	return eventStream(request.signal, (send) =>
		subscribeFactoryAlerts(userId, (event) => send(`data: ${JSON.stringify(event)}\n\n`))
	);
};
