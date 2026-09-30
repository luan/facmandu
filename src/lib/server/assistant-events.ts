import type { ConversationStreamChunk } from '@flue/runtime';
// Flue replays the conversation stream. Forward only this submission's messages and tools.
export function submissionEvents(id: string, accept: (chunk: ConversationStreamChunk) => void) {
	const messages = new Set<string>();
	const tools = new Set<string>();
	return (chunk: ConversationStreamChunk) => {
		if (chunk.type === 'message-started' && chunk.submissionId === id)
			messages.add(chunk.messageId);
		if ('messageId' in chunk && messages.has(chunk.messageId)) {
			if (chunk.type === 'tool-input') tools.add(chunk.toolCallId);
			accept(chunk);
		} else if ('toolCallId' in chunk && tools.has(chunk.toolCallId)) accept(chunk);
	};
}
