import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConversationStreamChunk } from '@flue/runtime';
import {
	assistantElapsed,
	assistantFinalText,
	assistantPreamble,
	assistantText,
	assistantToolFeedback,
	assistantToolProgress
} from '../src/lib/assistant-events';

test('progress names the actual tool operation and elapsed time without exposing its inputs', () => {
	assert.equal(
		assistantToolProgress('blueprint_operation', { operation: 'export', blueprint: 'private' }),
		'Blueprint: export…'
	);
	assert.equal(
		assistantToolProgress('factory_query', { operation: 'inspect_transport' }),
		'Inspecting factory: inspect transport…'
	);
	assert.equal(assistantToolProgress('sandbox_blueprint', null), 'Exporting sandbox blueprint…');
	assert.equal(assistantToolProgress('test_blueprint', null), 'Simulating blueprint…');
	assert.equal(
		assistantToolFeedback('test_blueprint', {
			result: { status: 'done', outputs: [{ met: true }, { met: false }] }
		}),
		'Sandbox trial: 1/2 output targets met. Live factory output is not verified.'
	);
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
		assistantToolFeedback('route_pipes', {
			results: [{ found: true }, { found: false }]
		}),
		'Drafted 1 of 2 pipe connections. No construction placed.'
	);
	assert.equal(
		assistantToolFeedback('route_belts', {
			results: [{ found: false, sourceBlocked: { x: 4.5, y: 7.5 } }]
		}),
		'Drafted 0 of 1 belt connections. A start coordinate cannot accept a belt. No construction placed.'
	);
	assert.equal(
		assistantToolFeedback('route_belts', {
			results: [{ found: true }, { found: false, sourceExit: { x: 1.5, y: 0.5, direction: 4 } }]
		}),
		'Drafted 1 of 2 belt connections. A start belt has no usable forward exit. No construction placed.'
	);
	assert.equal(
		assistantToolProgress('factory_batch', {
			afterSeconds: 30,
			queries: [{ tool: 'item_rate' }]
		}),
		'Waiting 30s before the next factory check…'
	);
	assert.equal(
		assistantToolProgress('factory_batch', {
			queries: [{ tool: 'item_rate' }, { tool: 'item_rate' }, { tool: 'current_research' }]
		}),
		'Inspecting factory: item rate, current research…'
	);
	assert.equal(
		assistantToolFeedback('factory_lookup', { title: 'Current research', result: {} }),
		''
	);
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
		'Draft validated: 700 entities; 2 warnings.'
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
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			entities: 0,
			tiles: 144,
			importValidated: true
		}),
		'Draft validated: 144 tiles.'
	);
});

test('construction feedback distinguishes ghosts, completed machines and measured delivery', () => {
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			result: { operation: 'place_blueprint', placed: 40, requested: 40 }
		}),
		'Placed 40 of 40 construction ghosts. Real items are required to build them.'
	);
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			result: {
				operation: 'place_blueprint',
				placed: 0,
				requested: 0,
				retained_built: 1,
				retained_ghosts: 1
			}
		}),
		'Retained 2 matching built entities or existing ghosts. No new ghosts needed.'
	);
	assert.equal(
		assistantToolFeedback('check_build', {
			result: {
				operation: 'check_build',
				constructed: 40,
				requested: 40,
				machines: [{ status: 'working' }, { status: 'no_power' }]
			}
		}),
		'Built 40 of 40 entities; 1 machine working. Delivery rate remains unmeasured.'
	);
	assert.equal(
		assistantToolFeedback('check_build', {
			result: { operation: 'check_build', constructed: 0, requested: 40, ghosts: 40 }
		}),
		'Built 0 of 40 entities. Delivery rate remains unmeasured.'
	);
	assert.equal(
		assistantToolFeedback('check_build', {
			result: {
				operation: 'check_build',
				constructed: 40,
				requested: 40,
				measurement: { measured: true }
			}
		}),
		'Built 40 of 40 entities. Delivery measurement available.'
	);
});

test('public tool-call preambles remain separate from final text and private reasoning', () => {
	const base = {
		conversationId: 'conversation',
		messageId: 'response',
		position: { batch: 1, index: 0 }
	};
	const call: ConversationStreamChunk = {
		...base,
		type: 'tool-input',
		toolCallId: 'call',
		toolName: 'factory_lookup',
		input: {}
	};
	let text = assistantText(undefined, {
		...base,
		type: 'message-started',
		submissionId: 'request'
	});
	text = assistantText(text, {
		...base,
		type: 'message-delta',
		kind: 'reasoning',
		delta: 'Private reasoning'
	});
	assert.equal(assistantPreamble(text, call), undefined);
	text = assistantText(text, {
		...base,
		type: 'message-delta',
		kind: 'text',
		delta: 'I found the sand bottleneck; I will connect a new crusher.'
	});
	assert.equal(
		assistantPreamble(text, call),
		'I found the sand bottleneck; I will connect a new crusher.'
	);
	assert.equal(assistantText(text, call), '');
	assert.equal(assistantPreamble(text, { ...base, type: 'message-completed' }), undefined);
});

test('placement feedback reports foundation tiles even when no entity ghosts were requested', () => {
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			operation: 'place_blueprint',
			placed: 0,
			requested: 0,
			placed_tiles: 6,
			requested_tiles: 6
		}),
		'Placed 6 of 6 tile ghosts. Real items are required to build them.'
	);
	assert.equal(
		assistantToolFeedback('blueprint_operation', {
			operation: 'place_blueprint',
			placed: 2,
			requested: 3,
			placed_tiles: 6,
			requested_tiles: 8
		}),
		'Placed 2 of 3 entity ghosts and 6 of 8 tile ghosts. Real items are required to build them.'
	);
});

test('factory summaries preserve partial evidence and distinguish machine status from delivery', () => {
	assert.equal(
		assistantToolFeedback('find_entities', {
			result: { total: 0, shown: 0, surface: 'nauvis', truncated: true }
		}),
		'Found 0 matching entities on nauvis in a partial scan.'
	);
	assert.equal(
		assistantToolFeedback('find_entities', {
			result: { total: 80, shown: 12, surface: 'nauvis', truncated: false }
		}),
		'Found 80 matching entities on nauvis; showing 12.'
	);
	assert.equal(
		assistantToolFeedback('inspect_machine', {
			result: { found: true, name: 'chemical-plant', status: 'no_ingredients' }
		}),
		'chemical plant: no ingredients.'
	);
	assert.equal(
		assistantToolFeedback('inspect_transport', { result: { found: false } }),
		'Target not found; refresh its location.'
	);
	assert.equal(
		assistantToolFeedback('factory_batch', {
			results: [
				{ tool: 'inspect_machine', ok: false, result: { name: 'furnace', status: 'working' } },
				{
					tool: 'inspect_machine',
					ok: true,
					result: { name: 'chemical-plant', status: 'no_ingredients' }
				},
				{
					tool: 'item_rate',
					ok: true,
					result: { item: 'space-science-pack', surface: 'platform-1', produced_per_min: 0 }
				},
				{ tool: 'item_rate', ok: true, result: { item: 'iron-plate', produced_per_min: 60 } },
				{ tool: 'factory_batch', ok: true, result: { results: [] } }
			]
		}),
		'chemical plant: no ingredients. space science pack: 0/min produced on platform-1. 1 query failed.'
	);
	assert.equal(
		assistantToolFeedback('item_rate', { item: 'iron-plate', produced_per_min: Infinity }),
		''
	);
	assert.equal(
		assistantToolFeedback('item_rate', { item: 'iron-plate', produced_per_min: '12.34' }),
		'iron plate: 12.34/min produced.'
	);
	assert.equal(
		assistantToolFeedback('science_summary', {
			result: {
				sciences: [{ item: 'space-science-pack' }],
				research: { active: false },
				truncated: true
			}
		}),
		'Read 1 science production rates (partial snapshot); research idle. Rates do not prove delivery.'
	);
	assert.equal(
		assistantToolFeedback('planning_recipes', {
			result: { product: 'kr-glass', enabled_total: 2, truncated: true }
		}),
		'2 unlocked recipes for kr glass; catalog is partial.'
	);
	assert.equal(
		assistantToolFeedback('find_resource_patches', {
			result: { total_patches: 1, truncated: true }
		}),
		'Found 1 resource patch in charted terrain (partial scan).'
	);
});
