import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	normalizeContext,
	type ToolCall
} from '@earendil-works/pi-ai';
import { z } from 'zod';
import { assistantStreamProgress } from '../src/lib/assistant-events';
import { decodeToolArguments, decodeToolStream } from '../src/lib/server/tool-arguments';

const input = z.strictObject({
	queries: z
		.array(z.strictObject({ tool: z.string(), args: z.record(z.string(), z.unknown()) }))
		.max(16),
	prompt: z.string()
});
const schema = z.toJSONSchema(input);
const query = { tool: 'game_time', args: { force: 'player' } };

test('decode declared structured fields while retaining strict validation and literal text', () => {
	const value = decodeToolArguments(
		{ queries: JSON.stringify([{ ...query, args: JSON.stringify(query.args) }]), prompt: '[1,2]' },
		schema
	);
	assert.deepEqual(input.parse(value), { queries: [query], prompt: '[1,2]' });
	for (const queries of ['not json', 'null', '{"tool":"game_time"}', '[{"extra":true}]'])
		assert.equal(
			input.safeParse(decodeToolArguments({ queries, prompt: '' }, schema)).success,
			false
		);
	assert.equal(
		input.safeParse(
			decodeToolArguments({ queries: JSON.stringify(Array(17).fill(query)), prompt: '' }, schema)
		).success,
		false
	);
	assert.deepEqual(decodeToolArguments({ opaque: '{"x":1}' }, undefined), { opaque: '{"x":1}' });
});

test('provider stream records and final message receive the same decoded tool arguments', async () => {
	const toolCall: ToolCall = {
		type: 'toolCall',
		id: 'call',
		name: 'batch',
		arguments: { queries: JSON.stringify([query]), prompt: '' }
	};
	const message: AssistantMessage = {
		role: 'assistant',
		content: [structuredClone(toolCall)],
		api: 'openai-completions',
		provider: 'test',
		model: 'test',
		stopReason: 'toolUse',
		timestamp: 1,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
		}
	};
	const source = createAssistantMessageEventStream();
	const progress: string[] = [];
	const stream = assistantStreamProgress(
		decodeToolStream(
			source,
			normalizeContext({
				messages: [],
				tools: [{ name: 'batch', description: '', parameters: schema }]
			})
		),
		(value) => progress.push(value)
	);
	source.push({ type: 'start', partial: message });
	source.push({ type: 'thinking_start', contentIndex: 0, partial: message });
	source.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
	source.push({
		type: 'toolcall_delta',
		contentIndex: 0,
		partial: message,
		delta: 'private arguments'
	});
	source.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
	source.push({ type: 'done', reason: 'toolUse', message });
	for await (const event of stream)
		if (event.type === 'toolcall_end')
			assert.deepEqual(input.parse(event.toolCall.arguments).queries, [query]);
	assert.deepEqual((await stream.result()).content, [toolCall]);
	assert.equal((await stream.result()).usage.totalTokens, 2);
	assert.deepEqual(progress, ['Reasoning…', 'Preparing batch…']);

	const failed = createAssistantMessageEventStream();
	const wrapped = decodeToolStream(failed, normalizeContext({ messages: [] }));
	const error: AssistantMessage = { ...message, stopReason: 'aborted', errorMessage: 'Stopped' };
	failed.push({ type: 'error', reason: 'aborted', error });
	for await (const event of wrapped) assert.equal(event.type, 'error');
	assert.equal((await wrapped.result()).stopReason, 'aborted');
});
