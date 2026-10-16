import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { blueprintInputSchema } from '../src/lib/blueprints';
import { factoryLayoutInput } from '../src/lib/factory-layout';
import { compileFactoryLayout } from '../src/lib/server/factory-layout-compiler';

const directory = 'src/lib/server/vendor/interpose/';
const modules = Object.fromEntries(
	readdirSync(`${directory}engine`, { recursive: true })
		.filter((path): path is string => typeof path === 'string' && path.endsWith('.lua'))
		.map((path) => [
			`engine.${path.replace(/\.lua$/u, '').replaceAll('/', '.')}`,
			readFileSync(`${directory}engine/${path}`, 'utf8')
		])
);
const pack = z
	.json()
	.parse(JSON.parse(readFileSync('tests/fixtures/interpose/base-2.1.21.json', 'utf8')));
const request = factoryLayoutInput.parse({
	force: 'player',
	surface: 'nauvis',
	label: 'Circuits',
	width: 20,
	height: 20,
	inputs: [
		{ item: 'iron-plate', perMinute: 90, position: { x: 0.5, y: 0.5 }, direction: 4 },
		{ item: 'copper-plate', perMinute: 135, position: { x: 0.5, y: 2.5 }, direction: 4 }
	],
	outputs: [
		{ item: 'electronic-circuit', perMinute: 90, position: { x: 19.5, y: 0.5 }, direction: 4 }
	],
	recipes: ['electronic-circuit', 'copper-cable'],
	tiers: {
		machine: 'assembling-machine-2',
		belt: 'transport-belt',
		underground: 'underground-belt',
		inserter: 'fast-inserter',
		pole: 'small-electric-pole'
	}
});

test('the compiler produces repeatable connected item factories with normal belt ports and power', async () => {
	const first = await compileFactoryLayout(request, pack, modules);
	const second = await compileFactoryLayout(request, pack, modules);
	assert.deepEqual(second, first);
	assert.equal(first.design.force, 'player');
	assert.ok(first.design.entities.some((e) => e.name === 'small-electric-pole'));
	assert.ok(first.design.wires.length > 0);
	assert.equal(first.ports.length, 3);
	for (const port of first.ports)
		assert.equal(first.design.entities[port.entity - 1]?.name, 'transport-belt');
	assert.ok(first.design.entities.every((e) => !e.name.startsWith('interpose-')));
	assert.deepEqual(first.inputs, [
		{ item: 'copper-plate', perMinute: 135 },
		{ item: 'iron-plate', perMinute: 90 }
	]);
	assert.ok(
		first.steps.some((step) => step.recipe === 'electronic-circuit' && step.perMinute === 90)
	);
});

test('a shortage or impossible target is refused rather than silently producing a smaller factory', async () => {
	await assert.rejects(
		compileFactoryLayout(
			{ ...request, inputs: request.inputs.map((p) => ({ ...p, perMinute: 1 })) },
			pack,
			modules
		),
		/Insufficient declared supply/
	);
	await assert.rejects(
		compileFactoryLayout(
			{ ...request, outputs: request.outputs.map((p) => ({ ...p, perMinute: 60000 })) },
			pack,
			modules
		),
		/belt|target|rate|capacity|budget/i
	);
});

test('layout requests accept only bounded production intent and the program entry point is removed', () => {
	assert.equal(factoryLayoutInput.safeParse({ ...request, program: 'return {}' }).success, false);
	assert.equal(factoryLayoutInput.safeParse({ ...request, width: 1000 }).success, false);
	assert.equal(
		factoryLayoutInput.safeParse({
			...request,
			outputs: [{ ...request.outputs[0], position: { x: 20.5, y: 0.5 } }]
		}).success,
		false
	);
	assert.equal(
		blueprintInputSchema.safeParse({
			operation: 'program',
			force: 'player',
			label: 'No',
			program: 'return {}'
		}).success,
		false
	);
});
