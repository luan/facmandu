import { and, eq, isNull, or } from 'drizzle-orm';
import { assistantChat } from './db/schema';

// The caller also restricts the sponsoring account and server. Unscoped legacy
// chats remain visible to their author until that author resumes and shares them.
export function forceChatScope(player: { name: string; force: string }) {
	return or(
		eq(assistantChat.gameForce, player.force),
		and(isNull(assistantChat.gameForce), eq(assistantChat.gamePlayer, player.name))
	);
}
