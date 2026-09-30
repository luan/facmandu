import { eq } from 'drizzle-orm';
import { db, userHasModlistAccess } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eventStream } from '$lib/server/event-stream';
import { addActiveViewer, addModlistListener, getActiveViewers } from '$lib/server/realtime';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	const modlistId = params.id;
	if (!modlistId) {
		return new Response('modlist id required', { status: 400 });
	}

	const modlist = await db
		.select({ publicRead: table.modList.publicRead })
		.from(table.modList)
		.where(eq(table.modList.id, modlistId))
		.get();
	if (!modlist) return new Response('modlist not found', { status: 404 });
	const hasAccess = locals.user ? await userHasModlistAccess(locals.user.id, modlistId) : false;
	if (!modlist.publicRead && !hasAccess) {
		return new Response('forbidden', { status: 403 });
	}
	const userId = locals.user?.id ?? 'anon';
	const username = locals.user?.username ?? 'Anonymous';

	return eventStream(request.signal, (send, close) => {
		const removePresence = addActiveViewer(modlistId, userId, username);
		send(
			`data: ${JSON.stringify({ type: 'presence-init', data: { viewers: getActiveViewers(modlistId) } })}\n\n`
		);
		const unsubscribe = addModlistListener(modlistId, (data) => {
			const event = JSON.parse(data) as {
				type: string;
				data?: { userId?: string; publicRead?: boolean };
			};
			if (
				event.type === 'modlist-deleted' ||
				(event.type === 'access-revoked' && event.data?.userId === userId) ||
				(event.type === 'visibility-changed' && !event.data?.publicRead && !hasAccess)
			) {
				send(`data: ${JSON.stringify({ type: event.type })}\n\n`);
				close();
				return;
			}
			send(`data: ${data}\n\n`);
		});
		return () => {
			unsubscribe();
			removePresence();
		};
	});
};
