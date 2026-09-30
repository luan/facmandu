import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { managedServer } from '$lib/server/db/schema';
import { ServerError } from '$lib/server/server-files';
import { modSyncJob } from '$lib/server/server-mod-sync';
import { requireStopped } from '$lib/server/server-process';
import { reserveServer, serverTask } from '$lib/server/server-tasks';
import { instanceSchema, publicServer, requireServer } from '$lib/server/servers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params }) => ({
	server: publicServer(await requireServer(locals.user?.id, params.serverId))
});
export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		const server = await requireServer(locals.user?.id, params.serverId);
		const release = reserveServer(server.id, 'Updating server');
		if (!release)
			return fail(409, { message: `${serverTask(server.id)}. Wait for this task to finish.` });
		try {
			if ((await modSyncJob(server.id))?.status === 'running')
				return fail(409, { message: 'Wait for the mod update to finish.' });
			const parsed = instanceSchema.safeParse(Object.fromEntries(await request.formData()));
			if (!parsed.success)
				return fail(400, { message: parsed.error.issues[0]?.message ?? 'Invalid server' });
			if (parsed.data.gamePort !== server.gamePort || parsed.data.rconPort !== server.rconPort)
				await requireStopped(server);
			try {
				await db.update(managedServer).set(parsed.data).where(eq(managedServer.id, server.id));
			} catch {
				return fail(409, { message: 'A server already uses one of these ports.' });
			}
			return { message: 'Server saved' };
		} catch (cause) {
			if (cause instanceof ServerError) return fail(cause.status, { message: cause.message });
			throw cause;
		} finally {
			release();
		}
	}
};
