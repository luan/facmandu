import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FactoryResult, savedBlueprintDrafts } from '../src/lib/assistant-results';

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
