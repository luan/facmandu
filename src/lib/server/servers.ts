import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { type ManagedServer, managedServer } from '$lib/server/db/schema';

export type ServerSummary = ManagedServer;
export const canManageServer = (userId: string | undefined): boolean =>
	!!userId &&
	(env.FACMANDU_OPERATOR_USER_IDS ?? '')
		.split(',')
		.map((id) => id.trim())
		.includes(userId);
export async function listServers(userId: string | undefined): Promise<ServerSummary[]> {
	if (!canManageServer(userId)) return [];
	return await db.select().from(managedServer).orderBy(managedServer.name);
}
export async function requireServer(
	userId: string | undefined,
	serverId: string
): Promise<ManagedServer> {
	if (!canManageServer(userId)) error(403, 'Server management is restricted');
	const server = await db.select().from(managedServer).where(eq(managedServer.id, serverId)).get();
	if (!server) error(404, 'Server not found');
	return server;
}
export const publicServer = (server: ManagedServer): ServerSummary => server;

export const instanceSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		gamePort: z.coerce.number().int().min(1024).max(65535),
		rconPort: z.coerce.number().int().min(1024).max(65535)
	})
	.refine((value) => value.gamePort !== value.rconPort, 'Choose separate game and RCON ports');

export const newInstanceSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		gamePort: z.preprocess(
			(value) => (value === '' ? undefined : value),
			z.coerce.number().int().min(1024).max(65535).optional()
		),
		rconPort: z.preprocess(
			(value) => (value === '' ? undefined : value),
			z.coerce.number().int().min(1024).max(65535).optional()
		)
	})
	.refine(
		(value) => !value.gamePort || value.gamePort !== value.rconPort,
		'Choose separate game and RCON ports'
	);
