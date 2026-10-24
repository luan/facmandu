import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blueprintCircuitSchema } from '../src/lib/blueprints';
import { parseBlueprintToolRequest } from '../src/lib/server/factory-blueprints';
import { resolveCircuitDesign } from '../src/lib/server/factory-circuits';

const design = {
	force: 'player',
	label: 'Copper cable 90% full',
	entities: [
		{ name: 'storage-chest', position: { x: 0.5, y: 0.5 } },
		{
			name: 'decider-combinator',
			direction: 4,
			position: { x: 2, y: 0.5 },
			control_behavior: {
				decider_conditions: {
					conditions: [
						{
							first_signal: { type: 'item', name: 'copper-cable' },
							comparator: '>',
							constant: 8640
						}
					],
					outputs: [
						{
							signal: { type: 'virtual', name: 'signal-A' },
							copy_count_from_input: false,
							constant: 1
						}
					],
					else_outputs: []
				}
			}
		},
		{
			name: 'small-lamp',
			position: { x: 4.5, y: 0.5 },
			control_behavior: {
				circuit_enabled: true,
				circuit_condition: {
					first_signal: { type: 'virtual', name: 'signal-A' },
					comparator: '>',
					constant: 0
				}
			}
		}
	],
	wires: [
		[1, 1, 2, 1],
		[2, 3, 3, 1]
	]
};
const catalog = {
	entities: [
		{ name: 'storage-chest', type: 'logistic-container', unlocked: true },
		{ name: 'decider-combinator', type: 'decider-combinator', unlocked: true },
		{ name: 'small-lamp', type: 'lamp', unlocked: true }
	]
};
test('small custom circuits use native blueprints without a production plan or sandbox adapter', () => {
	const request = parseBlueprintToolRequest({ operation: 'create_circuit', args: design });
	const result = resolveCircuitDesign(request.args, catalog);
	assert.equal(result.operation, 'create');
	assert.deepEqual(result.entities[1]?.control_behavior, design.entities[1]?.control_behavior);
	assert.deepEqual(result.wires, design.wires);
	assert.throws(() =>
		resolveCircuitDesign(design, {
			entities: catalog.entities.map((e) => ({ ...e, unlocked: false }))
		})
	);
	assert.throws(() =>
		resolveCircuitDesign(design, {
			entities: catalog.entities.map((e) => ({ ...e, type: 'assembling-machine' }))
		})
	);
	assert.throws(() =>
		resolveCircuitDesign({ ...design, entities: design.entities.slice(0, 1) }, catalog)
	);
});
test('circuit creation stays bounded and cannot admit production entities through extra fields', () => {
	assert.equal(
		blueprintCircuitSchema.safeParse({ ...design, entities: Array(65).fill(design.entities[1]) })
			.success,
		false
	);
	assert.equal(
		blueprintCircuitSchema.safeParse({
			...design,
			entities: [{ ...design.entities[1], position: { x: 33, y: 0 } }]
		}).success,
		false
	);
	assert.equal(
		blueprintCircuitSchema.safeParse({
			...design,
			entities: [{ ...design.entities[1], recipe: 'electronic-circuit' }]
		}).success,
		false
	);
	assert.throws(() => parseBlueprintToolRequest({ operation: 'create', args: design }));
	assert.throws(() =>
		resolveCircuitDesign(
			{ ...design, entities: [{ name: 'transport-belt', position: { x: 0.5, y: 0.5 } }] },
			{ entities: [{ name: 'transport-belt', type: 'transport-belt', unlocked: true }] }
		)
	);
});
