import { error, isHttpError } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { resolveChat } from '$lib/server/assistant-chats';
import { authenticationForm, requireSameOrigin } from '$lib/server/auth';
import { connectCodexVoice } from '$lib/server/codex-voice';
import { db, userHasModlistAccess } from '$lib/server/db';
import { assistantTurn, serverAssistantTurn } from '$lib/server/db/schema';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

const targetSchema = z.union([
	z.object({ listId: z.string().min(1).max(128), serverId: z.undefined().optional() }),
	z.object({ serverId: z.string().min(1).max(128), listId: z.undefined().optional() })
]);
const setupSchema = z.object({
	chat: z.string().min(1).max(128),
	sdp: z.string().min(1).max(12_000).startsWith('v=0')
});
// One setup per user in this single-process app. Use shared limits if it gains multiple replicas.
const connecting = new Set<string>();
export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.user) error(401, 'Sign in to use voice');
	requireSameOrigin(request, url);
	const fields = Object.fromEntries(await authenticationForm(request));
	const setup = setupSchema.safeParse(fields);
	const target = targetSchema.safeParse(fields);
	if (!setup.success || !target.success) error(400, 'Invalid voice connection');
	const userId = locals.user.id;
	if (target.data.listId) {
		if (!(await userHasModlistAccess(userId, target.data.listId))) error(403, 'List access denied');
	} else if (target.data.serverId) await requireServer(userId, target.data.serverId);
	const chat = await resolveChat(userId, target.data, setup.data.chat);
	if (chat.gamePlayer) error(403, 'Use voice in a web chat');
	if (connecting.has(userId)) error(429, 'A voice connection is already being prepared');
	connecting.add(userId);
	try {
		const table = target.data.listId ? assistantTurn : serverAssistantTurn;
		const history = await db
			.select({ prompt: table.prompt, answer: table.answer })
			.from(table)
			.where(and(eq(table.userId, userId), eq(table.chatId, chat.id), eq(table.state, 'done')))
			.orderBy(desc(table.createdAt))
			.limit(4);
		const answer = await connectCodexVoice(
			userId,
			chat.id,
			setup.data.sdp,
			history.reverse(),
			request.signal
		);
		return new Response(answer, {
			headers: { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' }
		});
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		error(502, 'Could not connect voice. Check your Codex connection in Settings and retry.');
	} finally {
		connecting.delete(userId);
	}
};
