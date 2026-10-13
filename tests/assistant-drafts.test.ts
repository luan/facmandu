import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	assistantMilestone,
	assistantTimeline,
	type FactoryResult,
	savedBlueprintDrafts
} from '../src/lib/assistant-results';

test('interrupted runs retain each saved design, including hidden drafts, without replay duplicates', () => {
	const draft = (id: string, label: string): FactoryResult => ({
		kind: 'factory-result',
		tool: 'blueprint_operation',
		title: 'Blueprint',
		display: false,
		result: {
			kind: 'blueprint',
			designId: id.repeat(64),
			label,
			blueprint: `0native${id}`,
			entities: [{ name: 'transport-belt', position: { x: 0.5, y: 0.5 }, width: 1, height: 1 }],
			cost: []
		}
	});
	const science = draft('a', 'Connected science upgrades');
	const collector = draft('b', 'Collector draft');
	const error: FactoryResult = {
		kind: 'factory-result',
		title: 'Failure',
		result: { error: 'RCON timed out' }
	};
	assert.deepEqual(
		savedBlueprintDrafts([science, science, error, collector]).map((item) => item.label),
		['Connected science upgrades', 'Collector draft']
	);
	assert.deepEqual(savedBlueprintDrafts([error]), []);
});

test('the latest public milestone stays available while later inspection tools finish', () => {
	const update = (message: string): FactoryResult => ({
		kind: 'factory-result',
		tool: 'report_progress',
		title: 'Toby',
		result: { message }
	});
	const inspection: FactoryResult = {
		kind: 'factory-result',
		tool: 'factory_lookup',
		title: 'Inspection',
		result: { message: 'This is tool data, not a milestone' }
	};
	assert.equal(
		assistantMilestone([
			update('Measured science rates.'),
			update('Quartz supply is the bottleneck.'),
			inspection
		]),
		'Quartz supply is the bottleneck.'
	);
	assert.equal(assistantMilestone([inspection]), '');
});

test('public milestones retain chronological tool groups without replay duplicates or tool narration', () => {
	const read: FactoryResult = {
		kind: 'factory-result',
		tool: 'factory_lookup',
		title: 'Read',
		result: { message: 'Internal tool text' }
	};
	const update: FactoryResult = {
		kind: 'factory-result',
		tool: 'report_progress',
		title: 'Toby',
		result: { message: 'Sand supply is limiting glass.' }
	};
	const final: FactoryResult = {
		...update,
		result: { message: 'Connected the new mine-to-bus design.' }
	};
	assert.deepEqual(assistantTimeline([read, read, update, update, read, final]), [
		{ kind: 'tools', items: [read, read] },
		{ kind: 'progress', message: 'Sand supply is limiting glass.' },
		{ kind: 'tools', items: [read] },
		{ kind: 'progress', message: 'Connected the new mine-to-bus design.' }
	]);
});
