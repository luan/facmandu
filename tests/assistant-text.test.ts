import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConversationStreamChunk } from '@flue/runtime';
import {
	assistantElapsed,
	assistantFinalText,
	assistantText,
	assistantToolFeedback,
	assistantToolProgress
} from '../src/lib/server/assistant-events';

test('progress names the actual tool operation and elapsed time without exposing its inputs', () => {
	assert.equal(
		assistantToolProgress('blueprint_operation', { operation: 'export', blueprint: 'private' }),
		'Blueprint: export…'
	);
	assert.equal(
		assistantToolProgress('factory_query', { operation: 'inspect_transport' }),
		'Inspecting factory: inspect transport…'
	);
	assert.equal(assistantToolProgress('sandbox_blueprint', null), 'Testing blueprint…');
	assert.equal(
		assistantToolProgress('factory_lookup', { tool: 'planning_recipes' }),
		'Inspecting factory: planning recipes…'
	);
	assert.equal(assistantToolProgress('factory_action', { operation: 42 }), 'Factory action…');
	assert.equal(assistantElapsed('Reasoning…', 1000, 86000), 'Reasoning… · 1m 25s elapsed');
	assert.equal(assistantElapsed('Thinking…', 1000, 500), 'Thinking… · 0m 0s elapsed');
});

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

test('accepted completion replaces drafts and older replies retain their final stream', () => {
	assert.equal(
		assistantFinalText(
			{ text: 'Draft.Final.', data: { 'assistant-answer': ['Draft.', 'Final.'] } },
			'Draft.Final.'
		),
		'Final.'
	);
	for (const value of [null, {}, ['Final.', null]]) {
		assert.equal(
			assistantFinalText({ text: 'Replay.', data: { 'assistant-answer': value } }, 'Streamed.'),
			'Streamed.'
		);
	}
	assert.equal(assistantFinalText({ text: 'Replay.', data: {} }), 'Replay.');
});

test('partial layout progress counts rows and revisions without exposing entity settings', () => {
	assert.equal(
		assistantToolProgress('blueprint_operation', {
			operation: 'create',
			args: { entities: [{}], entityRows: [{ count: 20 }], private: 'secret' }
		}),
		'Drafting blueprint: 21 entities described…'
	);
	assert.equal(
		assistantToolProgress('blueprint_operation', {
			operation: 'create',
			args: { entityChanges: [{}, {}, {}] }
		}),
		'Drafting blueprint: 3 entity edits described…'
	);
});

test('tool feedback distinguishes proposed drafts, placement faults and actual query results', () => {
	assert.equal(
		assistantToolFeedback('report_progress', {
			result: { message: 'Blue science supply connected; checking green science next.' }
		}),
		'Blue science supply connected; checking green science next.'
	);
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			entities: 700,
			importValidated: true,
			warnings: ['one', 'two']
		}),
		'Draft validated: 700 entities; 2 warnings. Not placed.'
	);
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			kind: 'factory-result',
			result: { ready: false, blocked: [{}], power: { uncovered_total: 2, unconnected_total: 3 } }
		}),
		'Placement check: 1 blocked position; 5 planned power gaps.'
	);
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			error: 'Blueprint entities overlap: private payload'
		}),
		'Layout validation found overlapping entities.'
	);
	assert.equal(
		assistantToolFeedback('factory_batch', { result: { results: [{ ok: true }, { ok: false }] } }),
		'Completed 2 factory queries; 1 failed.'
	);
	assert.equal(
		assistantToolFeedback('route_belt', { result: { found: false } }),
		'No valid belt route found in the searched area.'
	);
	assert.equal(assistantToolFeedback('blueprint_operation', { entities: 700 }), '');
});
