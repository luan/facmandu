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
