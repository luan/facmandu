import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { modSyncJob, startModSync } from '$lib/server/server-mod-sync';
import { canManageServer, requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

const requestSchema = z.object({
	listId: z.string().min(1).max(100),
	hash: z.string().regex(/^[a-f0-9]{64}$/u)
});

export const GET: RequestHandler = async ({ locals, params }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	const userId = locals.user?.id;
	if (!userId || !canManageServer(userId)) error(403, 'Server management is restricted');
	return json({ job: await modSyncJob(server.id) });
};

export const POST: RequestHandler = async ({ locals, request, params }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	const userId = locals.user?.id;
	if (!userId || !canManageServer(userId)) error(403, 'Server management is restricted');
	const body = requestSchema.safeParse(await request.json().catch(() => null));
	if (!body.success) error(400, 'Invalid mod update');
	const result = await startModSync(server, userId, body.data.listId, body.data.hash);
	if ('error' in result) return json(result, { status: 409 });
	return json(result, { status: 202 });
};
