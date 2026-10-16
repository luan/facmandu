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
const plasticPack = z
	.json()
	.parse(JSON.parse(readFileSync('tests/fixtures/interpose/plastic-2.1.21.json', 'utf8')));
const plastic = factoryLayoutInput.parse({
	force: 'player',
	surface: 'nauvis',
	label: 'Plastic',
	width: 32,
	height: 24,
	inputs: [
		{ item: 'coal', perMinute: 450, position: { x: 0.5, y: 0.5 }, direction: 4 },
		{
			item: 'petroleum-gas',
			type: 'fluid',
			perMinute: 9000,
			position: { x: 0.5, y: 6.5 },
			direction: 4
		}
	],
	outputs: [{ item: 'plastic-bar', perMinute: 900, position: { x: 24.5, y: 23.5 }, direction: 8 }],
	recipes: ['plastic-bar'],
	tiers: {
		machine: 'chemical-plant',
		belt: 'transport-belt',
		underground: 'underground-belt',
		splitter: 'splitter',
		inserter: 'fast-inserter',
		pole: 'medium-electric-pole',
		pipe: 'pipe',
		pipe_underground: 'pipe-to-ground'
	}
});

test('fluid-fed production keeps native pipe connections, full-belt rates and exact machine counts', async () => {
	const compiled = await compileFactoryLayout(plastic, plasticPack, modules);
	assert.deepEqual(await compileFactoryLayout(plastic, plasticPack, modules), compiled);
	assert.deepEqual(compiled.inputs, [
		{ item: 'coal', perMinute: 450 },
		{ item: 'petroleum-gas', type: 'fluid', perMinute: 9000 }
	]);
	const machines = compiled.design.entities.filter((e) => e.recipe === 'plastic-bar');
	assert.deepEqual(compiled.steps, [
		{ recipe: 'plastic-bar', machines: machines.length, perMinute: 900 }
	]);
	assert.equal(machines.length, 8);
	for (const machine of machines) {
		assert.equal(machine.direction, 4);
		assert.ok(
			compiled.design.entities.some(
				(e) =>
					e.name === 'pipe' &&
					e.position.x === machine.position.x + 2 &&
					e.position.y === machine.position.y - 1
			)
		);
	}
	const endpoint = compiled.test.inputs.find((p) => p.kind === 'fluid');
	assert.ok(endpoint);
	assert.equal(compiled.design.entities[endpoint.entity - 1]?.name, 'pipe');
	assert.equal(endpoint.perMinute, 9000);
	assert.equal(compiled.test.seconds, 120);
});

test('fluid budgets and full-belt port space are checked before publishing a design', async () => {
	const output = plastic.outputs[0];
	assert.ok(output);
	await assert.rejects(
		compileFactoryLayout(
			{
				...plastic,
				inputs: plastic.inputs.map((p) => (p.type === 'fluid' ? { ...p, perMinute: 100 } : p))
			},
			plasticPack,
			modules
		),
		/Insufficient declared fluid supply/
	);
	await assert.rejects(
		compileFactoryLayout(
			{ ...plastic, inputs: plastic.inputs.filter((p) => p.type !== 'fluid') },
			plasticPack,
			modules
		),
		/Declare the recipe fluid supply/
	);
	await assert.rejects(
		compileFactoryLayout(
			{
				...plastic,
				outputs: [{ ...output, position: { x: 31.5, y: 0.5 }, direction: 4 }]
			},
			plasticPack,
			modules
		),
		/side-loading tile/
	);
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

const robotPack = z
	.json()
	.parse(JSON.parse(readFileSync('tests/fixtures/interpose/robots-2.1.21.json', 'utf8')));
const robotRequest = factoryLayoutInput.parse({
	force: 'player',
	surface: 'nauvis',
	label: 'Robot frame block',
	width: 28,
	height: 28,
	inputs: [
		{ item: 'iron-plate', perMinute: 12, position: { x: 0.5, y: 0.5 }, direction: 4 },
		{ item: 'copper-plate', perMinute: 12, position: { x: 0.5, y: 3.5 }, direction: 4 },
		{ item: 'steel-plate', perMinute: 6, position: { x: 0.5, y: 6.5 }, direction: 4 },
		{ item: 'electronic-circuit', perMinute: 18, position: { x: 0.5, y: 9.5 }, direction: 4 },
		{ item: 'electric-engine-unit', perMinute: 6, position: { x: 0.5, y: 12.5 }, direction: 4 },
		{
			item: 'sulfuric-acid',
			type: 'fluid',
			perMinute: 240,
			position: { x: 0.5, y: 16.5 },
			direction: 4
		}
	],
	outputs: [
		{ item: 'flying-robot-frame', perMinute: 6, position: { x: 24.5, y: 27.5 }, direction: 8 }
	],
	recipes: ['battery', 'flying-robot-frame'],
	tiers: {
		machine: 'assembling-machine-2',
		crafters: ['chemical-plant'],
		belt: 'transport-belt',
		underground: 'underground-belt',
		splitter: 'splitter',
		inserter: 'fast-inserter',
		long_inserter: 'long-handed-inserter',
		pole: 'medium-electric-pole',
		pipe: 'pipe',
		pipe_underground: 'pipe-to-ground'
	}
});

test('mixed crafter blocks keep native machines, exact rates and distinct pipe endpoints', async () => {
	const compiled = await compileFactoryLayout(robotRequest, robotPack, modules);
	assert.deepEqual(await compileFactoryLayout(robotRequest, robotPack, modules), compiled);
	assert.deepEqual(compiled.steps, [
		{ recipe: 'battery', machines: 1, perMinute: 12 },
		{ recipe: 'flying-robot-frame', machines: 3, perMinute: 6 }
	]);
	assert.equal(compiled.design.entities.filter((e) => e.name === 'chemical-plant').length, 1);
	assert.equal(compiled.design.entities.filter((e) => e.name === 'assembling-machine-2').length, 3);
	assert.ok(compiled.design.entities.every((e) => !e.name.startsWith('__toby')));
	const pipes = compiled.design.entities.filter(
		(e) => e.name === 'pipe' || e.name === 'pipe-to-ground'
	);
	assert.equal(new Set(pipes.map((e) => `${e.position.x},${e.position.y}`)).size, pipes.length);
	assert.equal(compiled.test.inputs.find((p) => p.kind === 'fluid')?.perMinute, 240);
});

test('mixed crafters preserve proven supply budgets and each selected machine speed', async () => {
	const nativePack = z
		.json()
		.parse(JSON.parse(readFileSync('tests/fixtures/interpose/robots-am3-2.1.21.json', 'utf8')));
	const input = {
		...robotRequest,
		tiers: { ...robotRequest.tiers, machine: 'assembling-machine-3' },
		inputs: robotRequest.inputs.map((p) => ({ ...p, perMinute: p.perMinute * 10 }))
	};
	const compiled = await compileFactoryLayout(input, nativePack, modules);
	assert.deepEqual(compiled.steps, [
		{ recipe: 'battery', machines: 1, perMinute: 12 },
		{ recipe: 'flying-robot-frame', machines: 2, perMinute: 6 }
	]);
	assert.equal(compiled.test.inputs.find((p) => p.kind === 'fluid')?.perMinute, 2400);
	assert.equal(compiled.inputs.find((p) => p.type === 'fluid')?.perMinute, 240);
	assert.equal(compiled.test.outputs[0]?.perMinute, 6);
	assert.equal(compiled.design.entities.filter((e) => e.name === 'assembling-machine-3').length, 2);
});
