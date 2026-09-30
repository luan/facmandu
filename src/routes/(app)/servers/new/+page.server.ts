import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { managedServer } from '$lib/server/db/schema';
import { initializeServer } from '$lib/server/server-files';
import { allocateServerPorts } from '$lib/server/server-ports';
import { canManageServer, newInstanceSchema } from '$lib/server/servers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals }) => {
	if (!canManageServer(locals.user?.id)) error(403, 'Server management is restricted');
	return {};
};
export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!canManageServer(locals.user?.id)) error(403, 'Server management is restricted');
		const parsed = newInstanceSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success)
			return fail(400, { message: parsed.error.issues[0]?.message ?? 'Invalid server' });
		let ports: Awaited<ReturnType<typeof allocateServerPorts>>;
		try {
			ports = await allocateServerPorts(parsed.data);
		} catch (cause) {
			return fail(409, {
				message: cause instanceof Error ? cause.message : 'Could not assign ports'
			});
		}
		const id = crypto.randomUUID();
		let server = {
			id,
			...parsed.data,
			...ports,
			directory: join(
				env.FACMANDU_SERVER_DIRECTORY || join(homedir(), '.local/share/facmandu/servers'),
				id
			),
			selectedModlist: null
		};
		let inserted = await db.insert(managedServer).values(server).onConflictDoNothing().returning();
		// Retry a competing automatic allocation; explicit port choices stay explicit.
		for (
			let attempt = 0;
			!inserted.length && attempt < 4 && !parsed.data.gamePort && !parsed.data.rconPort;
			attempt++
		) {
			server = { ...server, ...(await allocateServerPorts(parsed.data)) };
			inserted = await db.insert(managedServer).values(server).onConflictDoNothing().returning();
		}
		if (!inserted.length)
			return fail(409, { message: 'A server already uses one of these ports.' });
		try {
			await initializeServer(server);
		} catch {
			await db.delete(managedServer).where(eq(managedServer.id, id));
			await rm(server.directory, { recursive: true, force: true }).catch(() => undefined);
			return fail(500, {
				message: 'Could not create the server files. Check directory permissions.'
			});
		}
		redirect(303, `/servers/${id}?tab=settings`);
	}
};
