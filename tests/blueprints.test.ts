import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
	blueprintArtifactSchema,
	blueprintRequestSchema,
	blueprintTargetSchema
} from '../src/lib/blueprints';
import { blueprintCommand } from '../src/lib/server/factory-blueprints';

const design = {
	force: 'player',
	label: 'Belt',
	entities: [{ name: 'transport-belt', position: { x: 0.5, y: 0.5 }, direction: 4 as const }]
};
const target = { ...design, surface: 'nauvis', position: { x: 20, y: 20 } };
test('blueprints reject arbitrary settings and unbounded layouts at the tool boundary', () => {
	for (const entities of [
		[],
		Array(201).fill(design.entities[0]),
		[{ ...design.entities[0], items: { 'iron-plate': 200 } }],
		[{ ...design.entities[0], position: { x: 0.1, y: 0.5 } }]
	]) {
		assert.equal(
			blueprintRequestSchema.safeParse({ ...design, operation: 'create', entities }).success,
			false
		);
	}
	assert.equal(blueprintRequestSchema.safeParse({ ...design, operation: 'create' }).success, true);
	assert.equal(blueprintRequestSchema.safeParse({ ...target, operation: 'place' }).success, false);
});
test('placement is bound to the inspected design and requires a fresh native tick', () => {
	const expectedDesign = createHash('sha256')
		.update(JSON.stringify(blueprintTargetSchema.parse(target)))
		.digest('hex');
	const request = blueprintRequestSchema.parse({
		...target,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	const entity = request.entities[0];
	if (!entity) throw new Error('Expected entity');
	assert.ok(blueprintCommand(request).startsWith('/silent-command'));
	assert.throws(
		() => blueprintCommand({ ...request, entities: [{ ...entity, name: 'pipe' }] }),
		/Blueprint changed/
	);
	assert.throws(
		() => blueprintCommand({ ...request, label: 'Different blueprint' }),
		/Blueprint changed/
	);
});
test('placement cannot move to another surface or position after inspection', () => {
	const expectedDesign = createHash('sha256')
		.update(JSON.stringify(blueprintTargetSchema.parse(target)))
		.digest('hex');
	const request = blueprintRequestSchema.parse({
		...target,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	assert.throws(
		() => blueprintCommand({ ...request, position: { x: 21, y: 20 } }),
		/Blueprint changed/
	);
	assert.throws(() => blueprintCommand({ ...request, surface: 'gleba' }), /Blueprint changed/);
});
test('rich blueprint artifacts need an importable string and validated layout', () => {
	const artifact = {
		kind: 'blueprint',
		label: 'Belt',
		blueprint: '0native',
		entities: [{ ...design.entities[0], width: 1, height: 1 }],
		cost: [{ name: 'transport-belt', count: 1 }]
	};
	assert.equal(blueprintArtifactSchema.safeParse(artifact).success, true);
	assert.equal(
		blueprintArtifactSchema.safeParse({ ...artifact, blueprint: 'https://example.com' }).success,
		false
	);
	assert.equal(blueprintArtifactSchema.safeParse({ ...artifact, entities: [] }).success, false);
});

test('foundation layouts use integer tiles and remain bound to the inspected layout', () => {
	const foundation = {
		force: 'player',
		label: 'Foundation',
		entities: [],
		tiles: [{ name: 'space-platform-foundation', position: { x: 0, y: 0 } }]
	};
	assert.equal(
		blueprintRequestSchema.safeParse({ ...foundation, operation: 'create' }).success,
		true
	);
	assert.equal(
		blueprintRequestSchema.safeParse({
			...foundation,
			operation: 'create',
			tiles: [{ name: 'space-platform-foundation', position: { x: 0.5, y: 0 } }]
		}).success,
		false
	);
	assert.equal(
		blueprintRequestSchema.safeParse({
			...foundation,
			operation: 'create',
			tiles: Array(1025).fill(foundation.tiles[0])
		}).success,
		false
	);
	const placement = { ...foundation, surface: 'platform-1', position: { x: 0, y: 0 } };
	const expectedDesign = createHash('sha256')
		.update(JSON.stringify(blueprintTargetSchema.parse(placement)))
		.digest('hex');
	const request = blueprintRequestSchema.parse({
		...placement,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	assert.throws(
		() =>
			blueprintCommand({
				...request,
				tiles: [{ name: 'space-platform-foundation', position: { x: 1, y: 0 } }]
			}),
		/Blueprint changed/
	);
	assert.equal(
		blueprintArtifactSchema.safeParse({
			kind: 'blueprint',
			label: 'Foundation',
			blueprint: '0native',
			tiles: foundation.tiles,
			warnings: ['Locked recipe'],
			cost: [{ name: 'space-platform-foundation', count: 1 }]
		}).success,
		true
	);
});

test('configured inserters preserve settings and bind placement to inspected configuration', () => {
	const configured = {
		...target,
		entities: [
			{
				name: 'inserter',
				position: { x: 0.5, y: 0.5 },
				direction: 0 as const,
				filters: [{ index: 1, name: 'iron-plate' }],
				use_filters: true,
				pickup_position: { x: 0, y: -2 },
				drop_position: { x: 0.25, y: 2.25 },
				control_behavior: { circuit_read_hand_contents: true },
				wires: [[1, 1, 2, 1]]
			},
			{ name: 'inserter', position: { x: 2.5, y: 0.5 }, direction: 0 as const }
		]
	};
	const parsed = blueprintTargetSchema.parse(configured);
	assert.deepEqual(parsed.entities[0], configured.entities[0]);
	const expectedDesign = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
	const request = blueprintRequestSchema.parse({
		...configured,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	assert.ok(blueprintCommand(request).startsWith('/silent-command'));
	assert.throws(
		() =>
			blueprintCommand({
				...request,
				entities: parsed.entities.map((entity) => ({ ...entity, use_filters: false }))
			}),
		/Blueprint changed/
	);
	assert.equal(
		blueprintTargetSchema.safeParse({
			...configured,
			entities: [{ ...configured.entities[0], pickup_position: { x: 10000, y: 0 } }]
		}).success,
		false
	);
});

test('collector filters and native combinator sections survive the tool boundary', () => {
	const entities = [
		{
			name: 'asteroid-collector',
			position: { x: 0.5, y: 0.5 },
			direction: 0,
			'chunk-filter': [{ index: 1, name: 'oxide-asteroid-chunk' }],
			control_behavior: {
				circuit_read_contents: true,
				include_hands: true,
				circuit_enabled: true,
				circuit_condition: {
					first_signal: { type: 'virtual', name: 'signal-A' },
					comparator: '>',
					constant: 0
				}
			}
		},
		{
			name: 'constant-combinator',
			position: { x: 4.5, y: 0.5 },
			direction: 0,
			control_behavior: {
				sections: {
					sections: [
						{
							index: 1,
							filters: [{ index: 1, type: 'item', name: 'oxide-asteroid-chunk', count: 1 }]
						}
					]
				}
			}
		}
	];
	assert.deepEqual(blueprintTargetSchema.parse({ ...target, entities }).entities, entities);
	assert.equal(
		blueprintTargetSchema.safeParse({
			...target,
			entities: [{ ...entities[0], 'chunk-filter': [{ index: 0, name: 'oxide-asteroid-chunk' }] }]
		}).success,
		false
	);
});
