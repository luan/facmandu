import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConversationStreamChunk } from '@flue/runtime';
import { assistantText } from '../src/lib/server/assistant-events';

test('tool progress and reasoning stay out of the persisted final answer', () => {
	const base = {
		conversationId: 'conversation',
		messageId: 'response',
		position: { batch: 1, index: 0 }
	};
	const chunks: ConversationStreamChunk[] = [
		{ ...base, type: 'message-started', submissionId: 'request' },
		{ ...base, type: 'message-delta', kind: 'text', delta: 'Let me inspect the factory.' },
		{ ...base, type: 'message-started', submissionId: 'request' },
		{ ...base, type: 'message-delta', kind: 'reasoning', delta: 'Private reasoning' },
		{ ...base, type: 'message-delta', kind: 'text', delta: 'Placed the connected ' },
		{ ...base, type: 'message-delta', kind: 'text', delta: 'construction ghosts.' }
	];
	assert.equal(
		chunks.reduce<string | undefined>(assistantText, undefined),
		'Placed the connected construction ghosts.'
	);
	assert.equal(assistantText(undefined, { ...base, type: 'message-completed' }), undefined);
});
