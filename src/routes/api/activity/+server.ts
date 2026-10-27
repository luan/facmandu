import { error } from '@sveltejs/kit';
import { eq, or } from 'drizzle-orm';
import { subscribeActivity } from '#lib/server/activity.js';
import { db } from '#lib/server/db/index.js';
import { modList, modListCollaborator } from '#lib/server/db/schema.js';
import { eventStream } from '#lib/server/event-stream.js';
import { addModlistListener } from '#lib/server/realtime.js';
import { recoverInterruptedJobs } from '#lib/server/server-mod-sync.js';
import { canManageServer } from '#lib/server/servers.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) error(401, 'Sign in to view background work');
	const operator = canManageServer(user.id);
	const lists = await db
		.selectDistinct({ id: modList.id })
		.from(modList)
		.leftJoin(modListCollaborator, eq(modList.id, modListCollaborator.modlistId))
		.where(or(eq(modList.owner, user.id), eq(modListCollaborator.userId, user.id)));
	const allowed = new Set(lists.map((list) => list.id));
	if (operator) await recoverInterruptedJobs();
	return eventStream(request.signal, (send) => {
		const unsubscribe = subscribeActivity(
			(activity) => (activity.scope === 'server' ? operator : allowed.has(activity.targetId)),
			(activity) => send(`data: ${JSON.stringify(activity)}\n\n`)
		);
		const accessListeners = lists.map(({ id }) =>
			addModlistListener(id, (payload) => {
				const event = JSON.parse(payload) as { type: string; data?: { userId?: string } };
				if (
					event.type === 'modlist-deleted' ||
					(event.type === 'access-revoked' && event.data?.userId === user.id)
				) {
					allowed.delete(id);
					send(`event: permissions\ndata: ${JSON.stringify({ removed: id })}\n\n`);
				}
			})
		);
		return () => {
			unsubscribe();
			for (const remove of accessListeners) remove();
		};
	});
};
