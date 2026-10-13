import type { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ConversationStreamChunk } from '@flue/runtime';

// Large blueprint arguments stream before Flue can emit a complete tool-input.
export function assistantStreamProgress(
	stream: AssistantMessageEventStream,
	send: (progress: string) => void
) {
	const iterator = stream[Symbol.asyncIterator].bind(stream);
	stream[Symbol.asyncIterator] = async function* () {
		let previous = '';
		for await (const event of { [Symbol.asyncIterator]: iterator }) {
			let progress = '';
			if (event.type === 'thinking_start') progress = 'Reasoning…';
			if (event.type === 'text_start') progress = 'Responding…';
			if (event.type === 'toolcall_start' || event.type === 'toolcall_delta') {
				const block = event.partial.content[event.contentIndex];
				if (block?.type === 'toolCall') {
					const label = assistantToolProgress(block.name, block.arguments);
					progress = `Preparing ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
				}
			}
			if (progress && progress !== previous) {
				previous = progress;
				send(progress);
			}
			yield event;
		}
	};
	return stream;
}

export function assistantToolProgress(tool: string, input: unknown) {
	const operation =
		input &&
		typeof input === 'object' &&
		'operation' in input &&
		typeof input.operation === 'string'
			? input.operation.replaceAll('_', ' ')
			: '';
	if (tool === 'blueprint_operation') return `Blueprint${operation ? `: ${operation}` : ''}…`;
	if (tool === 'factory_action') return `Factory action${operation ? `: ${operation}` : ''}…`;
	if (tool.startsWith('factory_')) return `Inspecting factory${operation ? `: ${operation}` : ''}…`;
	if (tool === 'plan_production') return 'Calculating production…';
	if (tool === 'render_blueprint') return 'Rendering blueprint…';
	if (tool === 'sandbox_blueprint') return 'Testing blueprint…';
	return `${tool.replaceAll('_', ' ')}…`;
}

export function assistantElapsed(progress: string, started: number, now: number) {
	const seconds = Math.max(0, Math.floor((now - started) / 1000));
	return `${progress} · ${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}
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

// Tool-call preambles are progress, not part of the final player-facing answer.
export function assistantText(previous: string | undefined, chunk: ConversationStreamChunk) {
	if (chunk.type === 'message-started' || chunk.type === 'tool-input') return '';
	if (chunk.type === 'message-delta' && chunk.kind === 'text')
		return (previous ?? '') + chunk.delta;
	return previous;
}

// Recovery and completion review can emit several drafts in one coalesced reply.
export function assistantFinalText(
	reply: { text: string; data: Record<string, unknown> },
	streamed?: string
) {
	const answers = reply.data['assistant-answer'];
	const accepted = Array.isArray(answers) ? answers.at(-1) : undefined;
	return typeof accepted === 'string' ? accepted : (streamed ?? reply.text);
}
