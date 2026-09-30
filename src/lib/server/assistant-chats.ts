import { error } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { genID } from './db/ids';
import { assistantChat } from './db/schema';

type Target = { listId: string } | { serverId: string };
const scope = (userId: string, target: Target) =>
	and(
		eq(assistantChat.userId, userId),
		'listId' in target
			? eq(assistantChat.listId, target.listId)
			: eq(assistantChat.serverId, target.serverId)
	);
// Callers authorize access to the list/server first; chat ownership is always private to its author.
export function chatHistory(userId: string, target: Target) {
	return db
		.select()
		.from(assistantChat)
		.where(scope(userId, target))
		.orderBy(desc(assistantChat.updatedAt), desc(assistantChat.id));
}
export async function newChat(userId: string, target: Target) {
	const chat = {
		id: genID('chat'),
		userId,
		...target,
		title: 'New chat',
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await db.insert(assistantChat).values(chat);
	return chat;
}
export async function resolveChat(userId: string, target: Target, id: string | null) {
	if (!id) return (await chatHistory(userId, target))[0] ?? (await newChat(userId, target));
	const chat = await db
		.select()
		.from(assistantChat)
		.where(and(scope(userId, target), eq(assistantChat.id, id)))
		.get();
	if (!chat) error(404, 'Chat not found');
	return chat;
}
export async function touchChat(
	chat: Pick<typeof assistantChat.$inferSelect, 'id' | 'title'>,
	prompt: string
) {
	await db
		.update(assistantChat)
		.set({
			updatedAt: new Date(),
			title: chat.title === 'New chat' ? prompt.replace(/\s+/gu, ' ').slice(0, 72) : chat.title
		})
		.where(eq(assistantChat.id, chat.id));
}
