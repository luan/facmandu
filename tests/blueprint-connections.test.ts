import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blueprintConnections } from '../src/lib/blueprint-connections';
import { blueprintArtifactSchema } from '../src/lib/blueprints';

test('groups repeated native connections without hiding external joins, recipes or faulty paths', () => {
	const artifact = blueprintArtifactSchema.parse({
		kind: 'blueprint',
		label: 'Plastic',
		blueprint: '0native',
		cost: [],
		entities: [
			{
				name: 'chemical-plant',
				recipe: 'plastic-bar',
				position: { x: 0, y: 0 },
				width: 3,
				height: 3
			},
			{ name: 'chemical-plant', recipe: 'sulfur', position: { x: 4, y: 0 }, width: 3, height: 3 },
			{ name: 'transport-belt', position: { x: 0.5, y: 3.5 }, width: 1, height: 1 }
		],
		inserter_transfers: Array.from({ length: 100 }, (_, i) => ({
			inserter: i + 4,
			pickup: { x: i * 4, y: 1 },
			drop: { x: i * 4, y: 3 },
			pickup_entity: 1,
			drop_entity: 3,
			drop_belt_side: 'left',
			belt_lane_items_per_second: 7.5,
			planned_belt_path: {
				status: 'external',
				length: i + 1,
				terminal_entity: 3,
				position: { x: 0.5, y: 3.5 },
				next_position: { x: 1.5, y: 3.5 }
			}
		}))
	});
	const original = structuredClone(artifact);
	const template = artifact.inserter_transfers[0];
	assert.ok(template);
	artifact.inserter_transfers.push({
		...template,
		inserter: 104,
		pickup_entity: 2
	});
	const external = { ...template, inserter: 105, pickup_entity: undefined };
	const fault = {
		...template,
		inserter: 106,
		planned_belt_path: {
			status: 'opposed' as const,
			length: 4,
			terminal_entity: 3,
			position: { x: 0.5, y: 3.5 },
			next_entity: 2
		}
	};
	artifact.inserter_transfers.push(external, fault);
	const summary = blueprintConnections(artifact);
	assert.equal(summary.groups.length, 2);
	const first = summary.groups[0];
	const second = summary.groups[1];
	assert.ok(first && second);
	assert.equal(first.transfers.length, 100);
	assert.deepEqual(first.transfers[99], [103, 1, 3]);
	assert.equal(first.pickup.recipe, 'plastic-bar');
	assert.equal(second.pickup.recipe, 'sulfur');
	assert.deepEqual(first.path?.next_position, { x: 1.5, y: 3.5 });
	assert.deepEqual(summary.external, [external]);
	assert.deepEqual(summary.faults, [fault]);
	assert.ok(
		JSON.stringify(summary).length < JSON.stringify(artifact.inserter_transfers).length / 3
	);
	assert.deepEqual(artifact.inserter_transfers.slice(0, 100), original.inserter_transfers);
});
