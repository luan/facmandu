import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { blueprintInputSchema } from '../src/lib/blueprints';
import {
	factoryLayoutJobInput as factoryLayoutInput,
	factoryLayoutInput as savedLayoutInput
} from '../src/lib/factory-layout';
import { compileFactoryLayout } from '../src/lib/server/factory-layout-compiler';
import {
	layoutFailureMessage,
	resolveFactoryLayout
} from '../src/lib/server/factory-layout-saved-plan';

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

test('finished robot blocks produce their battery and frame intermediates locally', async () => {
	const nativePack = z
		.json()
		.parse(JSON.parse(readFileSync('tests/fixtures/interpose/full-robots-2.1.21.json', 'utf8')));
	const request = factoryLayoutInput.parse({
		...robotRequest,
		label: 'Logistic robots',
		width: 28,
		height: 32,
		tiers: { ...robotRequest.tiers, machine: 'assembling-machine-3' },
		recipes: [...robotRequest.recipes, 'logistic-robot'],
		inputs: [
			...robotRequest.inputs,
			{ item: 'advanced-circuit', perMinute: 12, position: { x: 0.5, y: 19.5 }, direction: 4 }
		].map((p) => ({ ...p, perMinute: p.perMinute * 10 })),
		outputs: [{ item: 'logistic-robot', perMinute: 6, position: { x: 5.5, y: 31.5 }, direction: 8 }]
	});
	const compiled = await compileFactoryLayout(request, nativePack, modules);
	assert.deepEqual(compiled.steps, [
		{ recipe: 'battery', machines: 1, perMinute: 12 },
		{ recipe: 'flying-robot-frame', machines: 2, perMinute: 6 },
		{ recipe: 'logistic-robot', machines: 1, perMinute: 6 }
	]);
	assert.ok(compiled.inputs.every((p) => p.item !== 'battery' && p.item !== 'flying-robot-frame'));
	assert.equal(compiled.test.outputs[0]?.name, 'logistic-robot');
	const output = compiled.test.outputs[0];
	assert.ok(output);
	assert.equal(compiled.design.entities[output.entity - 1]?.position.x, 5.5);
});

test('standalone blocks need only supply rates and keep fixed ports when requested', async () => {
	const input = factoryLayoutInput.parse({
		...robotRequest,
		inputs: robotRequest.inputs.map(({ position, direction, ...port }) => port),
		outputs: [{ item: 'flying-robot-frame', perMinute: 6 }]
	});
	assert.deepEqual(input.inputs[0]?.position, { x: 0.5, y: 0.5 });
	assert.deepEqual(input.outputs[0]?.position, { x: 5.5, y: 27.5 });
	assert.equal(input.inputs[0]?.direction, 4);
	assert.equal(input.outputs[0]?.direction, 8);
	const compiled = await compileFactoryLayout(input, robotPack, modules);
	const output = compiled.ports.find((p) => p.kind === 'output');
	assert.ok(output);
	assert.deepEqual(output.position, { x: 5.5, y: 27.5 });
	assert.deepEqual(factoryLayoutInput.parse(robotRequest), robotRequest);
	assert.equal(factoryLayoutInput.safeParse({ ...input, height: 8 }).success, false);
	assert.equal(
		factoryLayoutInput.safeParse({
			...input,
			outputs: [{ ...input.outputs[0], position: input.inputs[0]?.position }]
		}).success,
		false
	);
});

test('default fluid entries are reserved before routing item belts', async () => {
	const request = factoryLayoutInput.parse({
		...plastic,
		inputs: plastic.inputs.map(({ position, direction, ...port }) => port),
		outputs: plastic.outputs.map(({ position, direction, ...port }) => port)
	});
	assert.deepEqual(request.outputs[0]?.position, { x: 24.5, y: 23.5 });
	const compiled = await compileFactoryLayout(request, plasticPack, modules);
	const fluid = request.inputs.find((p) => p.type === 'fluid');
	assert.ok(fluid);
	const entry = compiled.design.entities.filter(
		(e) => e.position.x === fluid.position.x && e.position.y === fluid.position.y
	);
	assert.equal(entry.length, 1);
	assert.equal(entry[0]?.name, 'pipe');
});

test('recipes sharing an assembler rotate only when they use its fluid connections', async () => {
	const nativePack = z
		.json()
		.parse(JSON.parse(readFileSync('tests/fixtures/interpose/motor-robots-2.1.21.json', 'utf8')));
	const input = factoryLayoutInput.parse({
		...robotRequest,
		width: 28,
		height: 44,
		tiers: { ...robotRequest.tiers, machine: 'assembling-machine-3' },
		recipes: ['battery', 'electric-engine-unit', 'flying-robot-frame', 'logistic-robot'],
		inputs: robotRequest.inputs
			.map(({ position, direction, ...port }) => ({
				...port,
				item: port.item === 'electric-engine-unit' ? 'engine-unit' : port.item,
				perMinute: port.item === 'electronic-circuit' ? 30 : port.perMinute
			}))
			.concat([
				{ item: 'advanced-circuit', perMinute: 12 },
				{ item: 'lubricant', type: 'fluid', perMinute: 90 }
			]),
		outputs: [{ item: 'logistic-robot', perMinute: 6 }]
	});
	const compiled = await compileFactoryLayout(input, nativePack, modules);
	const assemblers = compiled.design.entities.filter((e) => e.name === 'assembling-machine-3');
	assert.equal(assemblers.length, 4);
	for (const entity of assemblers) {
		assert.equal(entity.direction, entity.recipe === 'electric-engine-unit' ? 4 : 0);
	}
	assert.deepEqual(
		compiled.inputs.filter((p) => p.type === 'fluid'),
		[
			{ item: 'lubricant', type: 'fluid', perMinute: 90 },
			{ item: 'sulfuric-acid', type: 'fluid', perMinute: 240 }
		]
	);
});

const logisticsPack = z
	.json()
	.parse(JSON.parse(readFileSync('tests/fixtures/interpose/logistics-2.1.21.json', 'utf8')));
const logisticsRequest = factoryLayoutInput.parse({
	force: 'player',
	surface: 'nauvis',
	label: 'Robot-fed gears',
	width: 32,
	height: 32,
	inputs: [{ item: 'iron-plate', perMinute: 1800 }],
	outputs: [{ item: 'iron-gear-wheel', perMinute: 900 }],
	recipes: ['iron-gear-wheel'],
	logistics: { requester: 'requester-chest', provider: 'passive-provider-chest' },
	tiers: {
		machine: 'assembling-machine-2',
		belt: 'transport-belt',
		underground: 'underground-belt',
		inserter: 'fast-inserter',
		pole: 'medium-electric-pole'
	}
});
test('logistics-only factories include the whole requested production array, configured requests and providers', async () => {
	const result = await compileFactoryLayout(logisticsRequest, logisticsPack, modules);
	assert.deepEqual(result.steps, [{ recipe: 'iron-gear-wheel', machines: 10, perMinute: 900 }]);
	assert.deepEqual(result.inputs, [{ item: 'iron-plate', perMinute: 1800 }]);
	const chests = result.design.entities.filter((e) => e.name === 'requester-chest');
	assert.equal(chests.length, 10);
	assert.equal(
		result.design.entities.filter((e) => e.name === 'passive-provider-chest' && e.bar === 4).length,
		10
	);
	assert.equal(result.design.entities.filter((e) => e.name === 'fast-inserter').length, 20);
	assert.equal(
		result.design.entities.some((e) => e.name.includes('belt')),
		false
	);
	for (const chest of chests)
		assert.deepEqual(chest.request_filters, {
			sections: [
				{
					index: 1,
					filters: [
						{
							index: 1,
							type: 'item',
							name: 'iron-plate',
							quality: 'normal',
							comparator: '=',
							count: 90
						}
					]
				}
			]
		});
	assert.equal(
		result.test.inputs.reduce((n, p) => n + p.perMinute, 0),
		1800
	);
	assert.equal(
		result.test.outputs.reduce((n, p) => n + p.perMinute, 0),
		900
	);
	assert.ok(result.design.wires.length > 0);
	const oversupplied = await compileFactoryLayout(
		factoryLayoutInput.parse({
			...logisticsRequest,
			inputs: [{ item: 'iron-plate', perMinute: 3600 }]
		}),
		logisticsPack,
		modules
	);
	assert.deepEqual(oversupplied.design, result.design);
	assert.equal(
		oversupplied.test.inputs.reduce((sum, port) => sum + port.perMinute, 0),
		1800
	);
	const occupied = new Set<string>();
	for (const e of result.design.entities) {
		const size = e.name === 'assembling-machine-2' ? 3 : 1;
		for (let x = e.position.x - size / 2; x < e.position.x + size / 2; x++)
			for (let y = e.position.y - size / 2; y < e.position.y + size / 2; y++) {
				const tile = `${x},${y}`;
				assert.equal(occupied.has(tile), false, `${e.name} overlaps ${tile}`);
				occupied.add(tile);
			}
	}
});
test('logistics compilation refuses shortages and undersized blocks without reducing the production target', async () => {
	for (const request of [
		{ ...logisticsRequest, inputs: [{ item: 'iron-plate', perMinute: 100 }] },
		{
			...logisticsRequest,
			width: 8,
			height: 8,
			outputs: [
				{ item: 'iron-gear-wheel', perMinute: 900, position: { x: 7.5, y: 7.5 }, direction: 8 }
			]
		}
	])
		await assert.rejects(
			compileFactoryLayout(factoryLayoutInput.parse(request), logisticsPack, modules),
			/Insufficient declared logistics supply|do not fit/
		);
	assert.equal(
		factoryLayoutInput.safeParse({
			...logisticsRequest,
			recipes: ['iron-gear-wheel', 'copper-cable']
		}).success,
		false
	);
});

test('fluid-fed logistics arrays fit slow recipes without a single oversized machine row', async () => {
	const native = z
		.json()
		.parse(JSON.parse(readFileSync('tests/fixtures/interpose/rocket-fuel-2.1.21.json', 'utf8')));
	const input = factoryLayoutInput.parse({
		force: 'player',
		surface: 'vulcanus',
		label: 'Rocket fuel 120/min',
		width: 64,
		height: 48,
		inputs: [
			{ item: 'iron-plate', perMinute: 120 },
			{ item: 'kr-oxygen', type: 'fluid', perMinute: 6000 },
			{ item: 'light-oil', type: 'fluid', perMinute: 3600 }
		],
		outputs: [{ item: 'rocket-fuel', perMinute: 120 }],
		recipes: ['rocket-fuel'],
		logistics: { requester: 'requester-chest', provider: 'passive-provider-chest' },
		tiers: {
			machine: 'kr-fuel-refinery',
			belt: 'transport-belt',
			underground: 'underground-belt',
			splitter: 'splitter',
			inserter: 'fast-inserter',
			pole: 'medium-electric-pole',
			pipe: 'pipe',
			pipe_underground: 'pipe-to-ground'
		}
	});
	const compiled = await compileFactoryLayout(input, native, modules);
	assert.deepEqual(compiled.steps, [{ recipe: 'rocket-fuel', machines: 32, perMinute: 120 }]);
	assert.equal(compiled.test.seconds, 112);
	assert.equal(compiled.design.entities.filter((e) => e.name === 'kr-fuel-refinery').length, 32);
	assert.deepEqual(
		compiled.test.inputs.filter((p) => p.kind === 'fluid').map((p) => [p.name, p.perMinute]),
		[
			['light-oil', 3600],
			['kr-oxygen', 6000]
		]
	);
	assert.equal(
		compiled.test.outputs.reduce((sum, p) => sum + p.perMinute, 0),
		120
	);
	await assert.rejects(
		compileFactoryLayout(
			{
				...input,
				inputs: input.inputs.map((p) => (p.item === 'kr-oxygen' ? { ...p, perMinute: 5999 } : p))
			},
			native,
			modules
		),
		/Insufficient declared fluid supply/
	);
});

test('perpendicular underground pipe endpoints preserve both native fluid networks', () => {
	const result = spawnSync('lua', ['-'], {
		encoding: 'utf8',
		input: `
 package.path='src/lib/server/vendor/interpose/?.lua;'..package.path
 local fluids=require('engine.fluids')
 local pack={pipes={pipe={},['pipe-to-ground']={underground=10}}}
 local entities={
  {name='pipe',position={x=-.5,y=.5}},
  {name='pipe-to-ground',position={x=.5,y=.5},direction=12},
  {name='pipe-to-ground',position={x=4.5,y=.5},direction=4},
  {name='pipe',position={x=5.5,y=.5}},
  {name='pipe',position={x=2.5,y=-.5}},
  {name='pipe-to-ground',position={x=2.5,y=.5},direction=0},
  {name='pipe-to-ground',position={x=2.5,y=4.5},direction=8},
  {name='pipe',position={x=2.5,y=5.5}}
 }
 local problem,issues=fluids.load({area={{-2,-2},{7,7}},inputs={
  {fluid='water',position={x=-.5,y=.5}},{fluid='crude-oil',position={x=2.5,y=-.5}}},
 outputs={{fluid='water',position={x=5.5,y=.5}},{fluid='crude-oil',position={x=2.5,y=5.5}}}},pack)
 assert(problem and #issues==0)
 assert(fluids.validate(entities,problem,pack).ok)
 entities[3].direction=12
 assert(not fluids.validate(entities,problem,pack).ok,'A same-facing pair must remain disconnected')
 `
	});
	assert.equal(result.status, 0, result.stderr);
});

const chainPack = z
	.json()
	.parse(JSON.parse(readFileSync('tests/fixtures/interpose/rocket-chain-2.1.21.json', 'utf8')));
const chainRequest = factoryLayoutInput.parse({
	force: 'player',
	surface: 'vulcanus',
	label: 'Rocket fuel \u2014 complete current-tech fluid chain',
	nativePlan: true,
	width: 100,
	height: 100,
	inputs: [
		{ item: 'iron-plate', perMinute: 120 },
		{ item: 'calcite', perMinute: 207 },
		{ item: 'sulfuric-acid', type: 'fluid', perMinute: 20667 },
		{ item: 'heavy-oil', type: 'fluid', perMinute: 4800 }
	],
	outputs: [{ item: 'rocket-fuel', perMinute: 120 }],
	recipes: [
		'rocket-fuel',
		'heavy-oil-cracking',
		'kr-water-separation',
		'steam-condensation',
		'acid-neutralisation',
		'kr-burn-kr-hydrogen'
	],
	logistics: { requester: 'requester-chest', provider: 'passive-provider-chest' },
	tiers: {
		machine: 'kr-fuel-refinery',
		crafters: ['chemical-plant', 'kr-electrolysis-plant'],
		furnace: 'kr-flare-stack',
		belt: 'transport-belt',
		underground: 'underground-belt',
		inserter: 'fast-inserter',
		splitter: 'splitter',
		pipe: 'pipe',
		pipe_underground: 'pipe-to-ground',
		pole: 'medium-electric-pole'
	}
});

test('native fluid plans compile all production and disposal stages within a bounded block', {
	timeout: 20000
}, async () => {
	const compiled = await compileFactoryLayout(chainRequest, chainPack, modules);
	assert.deepEqual(await compileFactoryLayout(chainRequest, chainPack, modules), compiled);
	assert.deepEqual(
		compiled.steps.map(({ recipe, machines }) => [recipe, machines]),
		[
			['rocket-fuel', 32],
			['heavy-oil-cracking', 4],
			['kr-water-separation', 15],
			['steam-condensation', 4],
			['acid-neutralisation', 2],
			['kr-burn-kr-hydrogen', 3]
		]
	);
	assert.equal(compiled.design.entities.filter((e) => e.name === 'kr-flare-stack').length, 3);
	assert.ok(compiled.design.entities.length <= 1000);
	assert.ok(
		compiled.design.entities.every(
			(e) => e.position.x >= 0 && e.position.x < 100 && e.position.y >= 0 && e.position.y < 100
		)
	);
	assert.equal(
		factoryLayoutInput.safeParse({
			...chainRequest,
			inputs: [...chainRequest.inputs, { item: 'heavy-oil', type: 'fluid', perMinute: 4800 }]
		}).success,
		false
	);
	assert.equal(compiled.test.warmupSeconds, 300);
	assert.deepEqual(compiled.inputs.map((p) => p.item).sort(), [
		'calcite',
		'heavy-oil',
		'iron-plate',
		'sulfuric-acid'
	]);
	assert.equal(
		compiled.test.outputs.reduce((sum, p) => sum + p.perMinute, 0),
		120
	);
	assert.ok(compiled.test.inputs.every((p) => p.name !== 'kr-oxygen' && p.name !== 'water'));
	assert.ok(compiled.design.wires.length > 0);
	await assert.rejects(
		compileFactoryLayout(
			{ ...chainRequest, inputs: chainRequest.inputs.map((p) => ({ ...p, perMinute: 1 })) },
			chainPack,
			modules
		),
		/Insufficient native plan supply/
	);
	assert.equal(
		factoryLayoutInput.safeParse({
			...chainRequest,
			tiers: { ...chainRequest.tiers, pipe: undefined }
		}).success,
		false
	);
});

test('saved layouts preserve planner machine counts across shape, spacing and automatic inserter geometry', async () => {
	const snapshot = {
		reference: 'toby://plan/1/42',
		revision: 7,
		force: 'player',
		surface: 'nauvis',
		name: 'Saved gears',
		valid: true,
		status: 'solved',
		products: [{ name: 'iron-gear-wheel', type: 'item', perMinute: 900 }],
		ingredients: [{ name: 'iron-plate', type: 'item', perMinute: 900 }],
		byproducts: [],
		lines: [
			{
				lineId: 12,
				recipe: 'iron-gear-wheel',
				machine: 'assembling-machine-2',
				machines: 12,
				quality: 'normal',
				modules: [],
				active: true,
				products: [{ name: 'iron-gear-wheel', type: 'item', perMinute: 900 }],
				ingredients: [{ name: 'iron-plate', type: 'item', perMinute: 900 }]
			}
		]
	};
	const settings = {
		force: 'player',
		player: 'cfcluan',
		reference: snapshot.reference,
		expectedRevision: 7,
		width: 100,
		height: 100,
		tiers: {
			belt: 'transport-belt',
			underground: 'underground-belt',
			inserter: 'fast-inserter',
			pole: 'medium-electric-pole'
		},
		logistics: {
			requester: 'requester-chest',
			provider: 'storage-chest',
			requestSeconds: 45,
			outputSlots: 2
		}
	};
	const native = JSON.parse(readFileSync('tests/fixtures/interpose/options-2.1.21.json', 'utf8'));
	let wideWidth = 0,
		tallWidth = 0;
	for (const shape of ['wide', 'tall', 'square'] as const) {
		const selected = savedLayoutInput.parse({ ...settings, layout: { shape, spacing: 'compact' } });
		const { job, plan } = resolveFactoryLayout(selected, snapshot);
		const compiled = await compileFactoryLayout(job, z.json().parse({ ...native, plan }), modules);
		assert.deepEqual(
			compiled.steps.map((s) => [s.recipe, s.machines]),
			[['iron-gear-wheel', 12]]
		);
		const machines = compiled.design.entities.filter((e) => e.name === 'assembling-machine-2');
		assert.equal(machines.length, 12);
		const width =
			Math.max(...machines.map((e) => e.position.x)) -
			Math.min(...machines.map((e) => e.position.x));
		if (shape === 'wide') wideWidth = width;
		if (shape === 'tall') tallWidth = width;
		assert.ok(
			compiled.design.entities
				.filter((e) => e.name === 'fast-inserter')
				.every((e) => e.pickup_position && e.drop_position)
		);
		for (const chest of compiled.design.entities.filter((e) => e.name === 'storage-chest')) {
			assert.equal(chest.bar, 2);
			assert.deepEqual(chest.request_filters?.sections[0]?.filters, [
				{
					index: 1,
					type: 'item',
					name: 'iron-gear-wheel',
					quality: 'normal',
					comparator: '=',
					count: 0
				}
			]);
		}
		const requests = compiled.design.entities.filter((e) => e.name === 'requester-chest');
		assert.ok(
			requests.every((e) => e.request_filters?.sections[0]?.filters[0]?.name === 'iron-plate')
		);
	}
	assert.ok(wideWidth > tallWidth);
	const lowPlan = {
		...snapshot,
		revision: 8,
		products: snapshot.products.map((p) => ({ ...p, perMinute: 90 })),
		ingredients: snapshot.ingredients.map((p) => ({ ...p, perMinute: 90 })),
		lines: snapshot.lines.map((line) => ({
			...line,
			machines: 1,
			products: line.products.map((p) => ({ ...p, perMinute: 90 })),
			ingredients: line.ingredients.map((p) => ({ ...p, perMinute: 90 }))
		}))
	};
	const beltSelection = savedLayoutInput.parse({
		...settings,
		expectedRevision: 8,
		width: 32,
		height: 32,
		logistics: undefined,
		layout: { shape: 'square', spacing: 'spacious' }
	});
	const belt = resolveFactoryLayout(beltSelection, lowPlan);
	assert.equal(belt.job.nativePlan, true);
	const result = await compileFactoryLayout(
		belt.job,
		z.json().parse({ ...native, plan: belt.plan }),
		modules
	);
	assert.equal(result.design.entities.filter((e) => e.recipe === 'iron-gear-wheel').length, 1);
	assert.equal(
		result.design.entities.some((e) => e.name === 'storage-chest'),
		false
	);
	assert.throws(() => savedLayoutInput.parse({ ...settings, recipes: ['different-recipe'] }));
	assert.throws(() =>
		savedLayoutInput.parse({
			...settings,
			tiers: { ...settings.tiers, machine: 'assembling-machine-3' }
		})
	);
	assert.throws(
		() => resolveFactoryLayout(savedLayoutInput.parse(settings), { ...snapshot, revision: 8 }),
		/revision changed/
	);
	assert.throws(
		() => resolveFactoryLayout(savedLayoutInput.parse(settings), { ...snapshot, force: 'enemy' }),
		/another force/
	);
	for (const name of ['', '   '])
		assert.equal(
			resolveFactoryLayout(savedLayoutInput.parse(settings), { ...snapshot, name }).job.label,
			'Factory layout'
		);
	const { job, plan } = resolveFactoryLayout(savedLayoutInput.parse(settings), snapshot);
	const unqualified = structuredClone(native);
	delete unqualified.inserters['fast-inserter'].custom;
	const standard = await compileFactoryLayout(
		job,
		z.json().parse({ ...unqualified, plan }),
		modules
	);
	assert.ok(
		standard.design.entities
			.filter((e) => e.name === 'fast-inserter')
			.every((e) => !e.pickup_position && !e.drop_position)
	);
	const beyond = structuredClone(job);
	beyond.inserters = { input: { pickup: { x: -64, y: 0 }, drop: { x: 0, y: 1 } } };
	await assert.rejects(
		compileFactoryLayout(beyond, z.json().parse({ ...native, plan }), modules),
		/researched reach/
	);
});

test('saved mixed-fluid plans use belts, loaders and researched inserter reach without changing the planner', async () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/interpose/saved-rocket-belts-2.1.21.json', 'utf8')
	);
	const request = factoryLayoutInput.parse(fixture.request);
	const before = JSON.stringify(fixture.pack.plan);
	const result = await compileFactoryLayout(request, z.json().parse(fixture.pack), modules);
	assert.equal(JSON.stringify(fixture.pack.plan), before);
	assert.deepEqual(
		result.steps.map((s) => [s.recipe, s.machines]),
		[
			['rocket-fuel', 32],
			['heavy-oil-cracking', 4],
			['steam-condensation', 1],
			['acid-neutralisation', 1],
			['kr-water-separation', 15],
			['simple-coal-liquefaction', 8]
		]
	);
	assert.ok(result.design.entities.some((e) => e.name === 'aai-fast-loader'));
	assert.ok(
		result.design.entities
			.filter((e) => e.name === 'aai-fast-loader')
			.every((e) => e.type === 'output')
	);
	assert.ok(
		result.design.entities
			.filter((e) => e.name === 'harene-infused-kr-electrolysis-plant')
			.every((e) => e.direction === 0)
	);
	assert.equal(result.design.tiles.length, 375);
	assert.ok(result.design.tiles.every((tile) => tile.name === 'haronite-plate'));
	assert.ok(!result.design.entities.some((e) => e.name.includes('chest')));
	assert.ok(
		result.design.entities
			.filter((e) => e.name.includes('belt') || e.name.includes('splitter'))
			.every((e) => e.name.startsWith('fast-'))
	);
	assert.ok(
		result.design.entities.some(
			(e) =>
				e.name === 'bulk-inserter' && e.pickup_position?.y === -2 && (e.drop_position?.y ?? 0) >= 2
		)
	);
	for (const e of result.design.entities) {
		for (const p of [e.pickup_position, e.drop_position])
			if (p) assert.ok(Number.isInteger(p.x * 256) && Number.isInteger(p.y * 256));
	}
	assert.equal(result.test.inputs.find((p) => p.name === 'coal')?.perMinute, 960);
	assert.equal(result.test.inputs.find((p) => p.name === 'water')?.perMinute, 15000);
	assert.deepEqual(result.test.outputs.map((p) => p.name).sort(), ['kr-hydrogen', 'rocket-fuel']);
	assert.equal(result.test.outputs.find((p) => p.name === 'rocket-fuel')?.perMinute, 120);
	assert.ok(result.design.entities.length <= 2000);
	const positions = new Set<string>();
	for (const e of result.design.entities) {
		assert.ok(
			e.position.x >= 0 &&
				e.position.x < request.width &&
				e.position.y >= 0 &&
				e.position.y < request.height
		);
		const key = `${e.position.x},${e.position.y}`;
		assert.ok(!positions.has(key), `${e.name} overlaps ${key}`);
		positions.add(key);
	}
	await assert.rejects(
		compileFactoryLayout(
			factoryLayoutInput.parse({
				...request,
				width: 64,
				height: 64,
				outputs: request.outputs.map(({ position, direction, ...p }) => p)
			}),
			z.json().parse(fixture.pack),
			modules
		),
		/complete saved plan needs/
	);
	const standard = structuredClone(fixture.pack);
	delete standard.inserters['bulk-inserter'].custom;
	await assert.rejects(
		compileFactoryLayout(request, z.json().parse(standard), modules),
		/researched adjustable reach or a long-handed inserter/
	);
});

test('three-ingredient saved rows leave an approach to both inner belt lanes', async () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/interpose/saved-three-input-belts-2.1.21.json', 'utf8')
	);
	const result = await compileFactoryLayout(
		factoryLayoutInput.parse(fixture.request),
		z.json().parse(fixture.pack),
		modules
	);
	assert.deepEqual(
		result.steps.map((s) => [s.recipe, s.machines]),
		[['advanced-circuit', 16]]
	);
	assert.deepEqual(result.test.inputs.map((p) => p.name).sort(), [
		'copper-cable',
		'electronic-circuit',
		'kr-electronic-components'
	]);
	assert.ok(Math.abs((result.test.outputs[0]?.perMinute ?? 0) - 360) < 1e-6);
});

test('saved filtration separates both solid products with native inserter filters', async () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/interpose/saved-filtration-belts-2.1.21.json', 'utf8')
	);
	const request = factoryLayoutInput.parse(fixture.request);
	const result = await compileFactoryLayout(request, z.json().parse(fixture.pack), modules);
	assert.deepEqual(
		result.steps.map((s) => [s.recipe, s.machines]),
		[['kr-filter-rare-metal-ore-from-dirty-water', 1]]
	);
	assert.deepEqual(
		result.design.entities
			.filter((e) => e.use_filters)
			.flatMap((e) => e.filters?.map((f) => f.name) ?? [])
			.sort(),
		['kr-rare-metal-ore', 'stone']
	);
	assert.ok(
		result.design.entities.some((e) => e.use_filters && e.drop_position?.y === 2 + 51 / 256)
	);
	assert.ok(!result.design.entities.some((e) => e.name.includes('loader')));
	assert.deepEqual(result.test.outputs.map((p) => p.name).sort(), [
		'kr-rare-metal-ore',
		'stone',
		'water'
	]);
});

test('pipe routing can cross unconnected ports of the same fluid without duplicating them', () => {
	const result = spawnSync('lua', ['-'], {
		encoding: 'utf8',
		input: `
 package.path='src/lib/server/vendor/interpose/?.lua;'..package.path
 local fluids=require('engine.fluids')
 local allowed={}
 for x=0,7 do allowed[x..',8']=true end
 for y=1,8 do allowed['7,'..y]=true end
 local obstacles={}
 for x=0,8 do for y=0,9 do if not allowed[x..','..y] then obstacles[#obstacles+1]={x=x,y=y} end end end
 local outputs={}
 for _,y in ipairs{1,3,4,5} do outputs[#outputs+1]={fluid='water',position={x=7.5,y=y+.5}} end
 local pack={pipes={pipe={},['pipe-to-ground']={underground=2}}}
 local result,errors=fluids.solve({area={{0,0},{9,10}},inputs={{fluid='water',position={x=.5,y=8.5}}},outputs=outputs,obstacles=obstacles,tiers={pipe='pipe',underground='pipe-to-ground'}},pack)
 assert(result,errors and errors[1] and errors[1].message)
 assert(result.report.ok)
 `
	});
	assert.equal(result.status, 0, result.stderr);
});

test('native gas feedback reads one normal consumer and never sums independent buffers', () => {
	const result = spawnSync('lua', ['-'], {
		encoding: 'utf8',
		input: `
 local capture=dofile('src/lib/server/factory-layout-plan-pack.lua')
 local function machine(name,kind,input,output)
  local m={name=name,type=kind,tile_width=3,tile_height=3,crafting_categories={chemistry=true},fluidbox_prototypes={},get_max_circuit_wire_distance=function() return 9 end}
  for i,side in ipairs{input and 'input' or 'output',output and 'output' or 'input'} do
   m.fluidbox_prototypes[i]={index=i,volume=1000,production_type=side,pipe_connections={{connection_type='normal',direction=side=='input' and 12 or 4,positions={{x=side=='input' and -1 or 1,y=0},{x=0,y=1},{x=1,y=0},{x=0,y=-1}}}}}
  end
  return m
 end
 local gas=machine('gas','assembling-machine',true,true)
 local consumer=machine('consumer','assembling-machine',true,false)
 local flare=machine('flare','furnace',true,false)
 local pump={tile_width=1,tile_height=2,get_max_circuit_wire_distance=function() return 9 end}
 local function fluid(name,n) return {type='fluid',name=name,amount=n} end
 local function recipe(ingredients,products) return {enabled=true,energy=1,categories={'chemistry'},prototype={},ingredients=ingredients,products=products} end
 local recipes={gas=recipe({fluid('water',10)},{fluid('chlorine',20)}),consumer=recipe({fluid('chlorine',50)},{{type='item',name='salt',amount=1}}),flare=recipe({fluid('chlorine',10)},{})}
 prototypes={entity={gas=gas,consumer=consumer,flare=flare},fluid={water={default_temperature=15},chlorine={default_temperature=15}}}
 local function part(name,rate) return {type='fluid',name=name,perMinute=rate} end
 local plan={status='solved',ingredients={},products={},byproducts={},lines={{recipe='gas',machine='gas',machines=.1,ingredients={part('water',60)},products={part('chlorine',120)}},{recipe='consumer',machine='consumer',machines=.1,ingredients={part('chlorine',100)},products={}},{recipe='flare',machine='flare',machines=.1,ingredients={part('chlorine',20)},products={}}}}
 local request={recipes={'gas','consumer','flare'},inputs={},outputs={},tiers={pipe='pipe',pipe_underground='pipe-to-ground'}}
 local pack={machines={gas={},consumer={}},furnaces={flare={}},recipes={}}
 capture(request,{recipes=recipes},{},function(name) assert(name=='pump');return pump end,pack,{},plan)
 assert(pack.recipes.gas.regulation.fluid=='chlorine' and pack.recipes.gas.regulation.threshold==100)
 assert(pack.recipes.consumer.sensor.wire_reach==9)
 assert(pack.recipes.flare.disposal.threshold==200 and pack.recipes.flare.disposal.gate=='pump')
 plan.lines[2].machines=2
 capture(request,{recipes=recipes},{},function(name) assert(name=='pump');return pump end,pack,{},plan)
 assert(not pack.recipes.gas.regulation and not pack.recipes.consumer.sensor,'Independent consumer buffers must not mask starvation')
 assert(pack.recipes.flare.disposal.threshold==500)
 `
	});
	assert.equal(result.status, 0, result.stderr);
});

test('saved electrolysis with solid ingredients rotates native fluid sockets away from belt lanes', () => {
	const result = spawnSync('lua', ['-'], {
		encoding: 'utf8',
		input: `
 local machine={name='electrolyser',tile_width=5,tile_height=5,crafting_categories={chemistry=true},fluidbox_prototypes={}}
 -- The live five-tile electrolysis prototype: west inputs, east outputs at north rotation.
 for i,point in ipairs{{-2,-1},{-2,1},{2,-1},{2,1}} do
  local x,y=point[1],point[2]
  machine.fluidbox_prototypes[i]={index=i,volume=1000,production_type=i<=2 and 'input' or 'output',pipe_connections={{connection_type='normal',direction=i<=2 and 12 or 4,positions={{x=x,y=y},{x=-y,y=x},{x=-x,y=-y},{x=y,y=-x}}}}}
 end
 local recipe={enabled=true,energy=1,categories={'chemistry'},prototype={},ingredients={{type='fluid',name='water',amount=10},{type='item',name='salt',amount=1}},products={{type='fluid',name='hydrogen',amount=5},{type='fluid',name='chlorine',amount=5}}}
 prototypes={entity={electrolyser=machine},fluid={water={default_temperature=15},hydrogen={default_temperature=15},chlorine={default_temperature=15}}}
 local plan={status='solved',products={{type='fluid',name='hydrogen',perMinute=300}},lines={{recipe='electrolysis',machine='electrolyser',machines=1,ingredients={{type='fluid',name='water',perMinute=600},{type='item',name='salt',perMinute=60}},products={{type='fluid',name='hydrogen',perMinute=300},{type='fluid',name='chlorine',perMinute=300}}}},ingredients={{type='fluid',name='water',perMinute=600},{type='item',name='salt',perMinute=60}},byproducts={{type='fluid',name='chlorine',perMinute=300}}}
 local request={recipes={'electrolysis'},inputs={{type='fluid',item='water',perMinute=600},{type='item',item='salt',perMinute=60}},outputs={{type='fluid',item='hydrogen'},{type='fluid',item='chlorine'}},tiers={pipe='pipe',pipe_underground='pipe-to-ground'}}
 local pack={machines={electrolyser={}},furnaces={},recipes={}}
 dofile('src/lib/server/factory-layout-plan-pack.lua')(request,{recipes={electrolysis=recipe}},{},nil,pack,{},plan)
 local captured=pack.recipes.electrolysis
 assert(captured.direction==0,'The native ports must rotate with the machine')
 assert(captured.fluid_outputs[1].volume==1000,'Capture the native fluid capacity')
 assert(not captured.regulation,'Do not throttle gas outputs that have no disposal stage')
 assert(captured.fluid_inputs[1].position.x==-3 and captured.fluid_inputs[1].position.y==-1)
 assert(captured.fluid_outputs[1].position.x==3 and captured.fluid_outputs[2].position.x==3)
 assert(#captured.fluid_connections==4,'Reserve the alternate water socket too')
 assert(plan.lines[1].machine=='electrolyser' and plan.lines[1].machines==1,'Do not replace the saved machine')
 recipe.products[1]={type='fluid',name='hydrogen',amount_min=1,amount_max=9,independent_probability=.5}
 recipe.prototype.get_product_amount=function(index,productivity) assert(productivity==0);return index==1 and 2.5 or 5 end
 dofile('src/lib/server/factory-layout-plan-pack.lua')(request,{recipes={electrolysis=recipe}},{},nil,pack,{},plan)
 assert(pack.recipes.electrolysis.results[1].amount==2.5,'Use the native expected yield for random recipe outputs')
 recipe.ingredients={{type='item',name='salt',amount=1}};recipe.products={{type='item',name='salt',amount=1}};recipe.prototype={}
 dofile('src/lib/server/factory-layout-plan-pack.lua')(request,{recipes={electrolysis=recipe}},{},nil,pack,{},plan)
 assert(pack.recipes.electrolysis.direction==0,'Dry recipes must keep the rotation that native export retains')
 `
	});
	assert.equal(result.status, 0, result.stderr);
});

test('fluid routes respect alternate machine sockets before their pipes are placed', () => {
	const result = spawnSync('lua', ['-'], {
		encoding: 'utf8',
		input: `
 package.path='src/lib/server/vendor/interpose/?.lua;'..package.path
 local fluids=require('engine.fluids')
 local pack={pipes={pipe={},['pipe-to-ground']={underground=8}}}
 local request={area={{0,0},{12,12}},inputs={{fluid='acid',position={x=.5,y=5.5}}},outputs={{fluid='acid',position={x=10.5,y=5.5}}},reservations={{fluid='water',x=5,y=5}},tiers={pipe='pipe',underground='pipe-to-ground'}}
 local result,errors=fluids.solve(request,pack)
 assert(result,errors and errors[1] and errors[1].message)
 for _,e in ipairs(result.blueprint.blueprint.entities) do assert(e.position.x~=5.5 or e.position.y~=5.5,'Acid occupied the alternate water socket') end
 request.outputs[1].position={x=5.5,y=5.5}
 local conflict,errors=fluids.solve(request,pack)
 assert(not conflict and errors[1].code=='fluid-ports-overlap','A declared pipe cannot use another fluid socket')
 `
	});
	assert.equal(result.status, 0, result.stderr);
});

test('layout errors contain readable messages instead of validation JSON or Lua stack prefixes', () => {
	const invalid = factoryLayoutInput.safeParse({});
	assert.ok(!invalid.success);
	const message = layoutFailureMessage(invalid.error);
	assert.ok(message.length > 0 && message.length <= 500);
	assert.ok(!message.startsWith('[') && !message.includes('"code"') && !message.includes('"path"'));
	assert.equal(
		layoutFailureMessage(new Error('stdin:123: Enlarge the factory block')),
		'Enlarge the factory block'
	);
});

test('saved glass keeps every machine and splits internal sand across red-belt rows with substations', async () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/interpose/saved-glass-belts-2.1.21.json', 'utf8')
	);
	const result = await compileFactoryLayout(
		factoryLayoutInput.parse(fixture.request),
		z.json().parse(fixture.pack),
		modules
	);
	assert.deepEqual(
		result.steps.map((s) => [s.recipe, s.machines]),
		[
			['kr-glass', 30],
			['kr-sand', 8]
		]
	);
	assert.equal(result.test.outputs[0]?.perMinute, 1800);
	assert.ok(result.design.entities.some((e) => e.name === 'substation'));
	assert.ok(
		result.design.entities
			.filter((e) => e.name.includes('transport-belt'))
			.every((e) => e.name === 'fast-transport-belt')
	);
	assert.equal(result.test.inputs.find((p) => p.name === 'stone')?.perMinute, 1440);
});

test('belt routing accepts every valid direction when goals share a tile', () => {
	const result = spawnSync('lua', ['-'], {
		encoding: 'utf8',
		input: `
 package.path='src/lib/server/vendor/interpose/?.lua;'..package.path
 local routing=require('engine.routing.init')
 local pack={belts={belt={size={1,1}}},undergrounds={ug={size={1,1},max_distance=4}}}
 local obstacles={} for x=0,6 do for _,y in ipairs{0,2} do obstacles[#obstacles+1]={x=x,y=y} end end
 local base={{name='belt',position={x=.5,y=1.5},direction=4},{name='belt',position={x=5.5,y=1.5},direction=4}}
 local net={label='corridor',from={x=1,y=1,dir=4,from_x=0,from_y=1},goals={{x=5,y=1,dirs={[4]=true}},{x=5,y=1,dirs={[0]=true}}}}
 local result,errors=routing.route({net},base,{area={{0,0},{7,3}},tiers={belt='belt',underground='ug'},obstacles=obstacles},pack)
 assert(result,errors and errors[1] and errors[1].message)
 `
	});
	assert.equal(result.status, 0, result.stderr);
});

test('two saved disposal stages using the same furnace retain their distinct fluid sockets', async () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/interpose/saved-gas-disposal-2.1.21.json', 'utf8')
	);
	const result = await compileFactoryLayout(
		factoryLayoutInput.parse(fixture.request),
		z.json().parse(fixture.pack),
		modules
	);
	assert.deepEqual(
		result.steps.map((s) => [s.recipe, s.machines]),
		[
			['kr-water-electrolysis', 1],
			['kr-hydrogen-chloride', 1],
			['kr-burn-kr-hydrogen', 1],
			['kr-burn-kr-chlorine', 1]
		]
	);
	assert.equal(result.test.outputs.find((p) => p.name === 'kr-hydrogen-chloride')?.perMinute, 60);
});

for (const circuitReach of [20.25, 15])
	test(`the complete saved processing-unit plan routes with circuit reach ${circuitReach}`, {
		timeout: 15000
	}, async () => {
		const fixture = JSON.parse(
			readFileSync('tests/fixtures/interpose/saved-processing-units-belts-2.1.21.json', 'utf8')
		);
		fixture.pack.poles.substation.circuit_reach = circuitReach;
		const result = await compileFactoryLayout(
			factoryLayoutInput.parse(fixture.request),
			z.json().parse(fixture.pack),
			modules
		);
		assert.equal(result.steps.length, 26);
		assert.equal(result.design.entities.filter((e) => e.name === 'storage-tank').length, 2);
		assert.equal(
			result.steps.reduce((n, step) => n + step.machines, 0),
			102
		);
		assert.ok(
			Math.abs(
				(result.test.outputs.find((p) => p.name === 'processing-unit')?.perMinute ?? 0) - 120
			) < 1e-6
		);
		assert.ok(result.design.entities.length > 2000);
		assert.ok(result.design.entities.length <= 3000);
		assert.ok(
			result.design.entities.every(
				(e) => e.position.x >= 0 && e.position.x < 100 && e.position.y >= 0 && e.position.y < 100
			)
		);
		assert.ok(blueprintInputSchema.safeParse({ ...result.design, operation: 'create' }).success);
		const disposal = result.design.entities.filter((e) => e.name === 'kr-flare-stack');
		assert.equal(disposal.length, 2);
		const controls = result.design.entities.filter((e) => e.name === 'pump');
		assert.equal(controls.length, 2);
		assert.ok(disposal.every((e) => !e.control_behavior));
		assert.deepEqual(
			controls.map((e) => e?.control_behavior?.circuit_condition),
			[
				['kr-hydrogen', 200],
				['kr-chlorine', 200]
			].map(([name, constant]) => ({
				first_signal: { type: 'fluid', name },
				comparator: '>',
				constant
			}))
		);
		for (const entity of controls) {
			assert.ok(entity);
			assert.equal(entity.control_behavior?.read_contents ?? false, false);
			assert.equal(entity.control_behavior?.circuit_enabled, true);
			const index = result.design.entities.indexOf(entity) + 1;
			const wire = result.design.wires.find(
				([from, connector]) => from === index && connector === 2
			);
			assert.ok(wire, 'Each overflow pump must read the consumer circuit network');
			const pole = result.design.entities[wire[2] - 1];
			assert.equal(pole?.name, 'substation');
			assert.ok(
				pole &&
					Math.hypot(pole.position.x - entity.position.x, pole.position.y - entity.position.y) <= 9
			);
		}
		const electrolyser = result.design.entities.find((e) => e.name === 'kr-electrolysis-plant');
		assert.ok(electrolyser);
		assert.deepEqual(electrolyser.control_behavior?.circuit_condition, {
			first_signal: { type: 'fluid', name: 'kr-chlorine' },
			comparator: '<',
			constant: 100
		});
		assert.equal(electrolyser.control_behavior?.read_contents, false);
		const producer = result.design.entities.indexOf(electrolyser) + 1;
		assert.ok(
			result.design.wires.some(
				([from, color, , targetColor]) => from === producer && color === 2 && targetColor === 2
			),
			'Production demand must use a separate network from disposal contents'
		);
		const consumer = result.design.entities.find((e) => e.recipe === 'kr-hydrogen-chloride');
		assert.ok(consumer);
		assert.equal(consumer.control_behavior?.read_contents, true);
		assert.equal(consumer.control_behavior?.circuit_enabled, false);
		assert.equal(consumer.control_behavior?.circuit_condition, undefined);
		for (const [from, color, to] of result.design.wires)
			if (color === 2) {
				const a = result.design.entities[from - 1];
				const b = result.design.entities[to - 1];
				assert.ok(a && b);
				const reach = a.name === 'substation' && b.name === 'substation' ? circuitReach : 9;
				assert.ok(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= reach);
			}
		const reachable = new Set([producer]);
		for (let pass = 0; pass < result.design.wires.length; pass++) {
			for (const [from, color, to, targetColor] of result.design.wires) {
				if (color === 2 && targetColor === 2 && (reachable.has(from) || reachable.has(to))) {
					reachable.add(from);
					reachable.add(to);
				}
			}
		}
		assert.ok(
			reachable.has(result.design.entities.indexOf(consumer) + 1),
			'The producer must read its normal consumer across stages'
		);
	});

for (const transport of ['belts', 'robots'] as const)
	test(`the current 60/min processing-unit plan supports ${transport} without importing intermediates`, {
		timeout: 15000
	}, async () => {
		const fixture = JSON.parse(
			readFileSync('tests/fixtures/interpose/saved-processing-units-60-2.1.21.json', 'utf8')
		);
		const logistics =
			transport === 'robots'
				? {
						requester: 'requester-chest',
						provider: 'storage-chest',
						requestSeconds: 30,
						outputSlots: 4
					}
				: undefined;
		const request = factoryLayoutInput.parse({
			...fixture.request,
			logistics,
			layout: { shape: 'square', spacing: transport === 'robots' ? 'spacious' : 'compact' }
		});
		const result = await compileFactoryLayout(request, z.json().parse(fixture.pack), modules);
		assert.equal(result.steps.length, 26);
		assert.equal(
			result.steps.reduce((n, s) => n + s.machines, 0),
			60
		);
		assert.ok(blueprintInputSchema.safeParse({ ...result.design, operation: 'create' }).success);
		assert.ok(
			result.design.entities.every(
				(e) => e.position.x >= 0 && e.position.x < 100 && e.position.y >= 0 && e.position.y < 100
			)
		);
		assert.ok(Math.abs(result.test.outputs.reduce((n, p) => n + p.perMinute, 0) - 60) < 1e-6);
		const declared = new Set(request.inputs.map((p) => p.item));
		assert.ok(
			result.test.inputs.every((p) => declared.has(p.name)),
			'Trials must never inject internally produced intermediates'
		);
		if (transport === 'robots') {
			for (const part of fixture.pack.plan.ingredients.filter(
				(p: { type: string; perMinute: number }) => p.type === 'item' && p.perMinute > 0
			)) {
				assert.ok(
					Math.abs(
						result.test.inputs
							.filter((p) => p.name === part.name)
							.reduce((n, p) => n + p.perMinute, 0) - part.perMinute
					) < 1e-6
				);
			}
			for (const name of ['stone', 'kr-rare-metal-ore']) {
				assert.ok(
					result.design.entities.some(
						(e) =>
							e.name === 'storage-chest' &&
							e.request_filters?.sections[0]?.filters[0]?.name === name
					),
					`Separate filtered ${name} output`
				);
				assert.ok(
					result.design.entities.some((e) => e.use_filters && e.filters?.[0]?.name === name)
				);
			}
			assert.ok(
				result.design.entities.some(
					(e) =>
						e.name === 'requester-chest' &&
						e.request_filters?.sections[0]?.filters.some((f) => f.name === 'kr-rare-metals')
				)
			);
		}
	});

// A real two-stage plan keeps copper cable inside the factory; only plates cross its boundary.
const mixedTransportPack = JSON.parse(
	readFileSync('tests/fixtures/interpose/base-2.1.21.json', 'utf8')
);
mixedTransportPack.pipes = {};
mixedTransportPack.inserters['fast-inserter'].rotation_speed = 0.08;
mixedTransportPack.inserters['fast-inserter'].stack_size = 5;
mixedTransportPack.chests = {
	'requester-chest': { size: [1, 1], mode: 'requester', capacity: 48 },
	'storage-chest': { size: [1, 1], mode: 'storage', capacity: 48 },
	'buffer-chest': { size: [1, 1], mode: 'buffer', capacity: 48 }
};
mixedTransportPack.inserters['fast-inserter'].custom = {
	range: 3,
	cross: true,
	diagonal: true,
	all: true,
	offsets: true
};
const itemRate = (name: string, perMinute: number) => ({ type: 'item', name, perMinute });
mixedTransportPack.plan = {
	status: 'solved',
	ingredients: [itemRate('iron-plate', 90), itemRate('copper-plate', 135)],
	products: [itemRate('electronic-circuit', 90)],
	byproducts: [],
	lines: [
		{
			recipe: 'copper-cable',
			machine: 'assembling-machine-2',
			machines: 2,
			ingredients: [itemRate('copper-plate', 135)],
			products: [itemRate('copper-cable', 270)]
		},
		{
			recipe: 'electronic-circuit',
			machine: 'assembling-machine-2',
			machines: 1,
			ingredients: [itemRate('iron-plate', 90), itemRate('copper-cable', 270)],
			products: [itemRate('electronic-circuit', 90)]
		}
	]
};
for (const inputs of ['belts', 'requester-chests'] as const)
	for (const intermediates of ['belts', 'buffer-chests'] as const)
		for (const outputs of ['belts', 'storage-chests'] as const)
			test(`independent solid transport: ${inputs} / ${intermediates} / ${outputs}`, async () => {
				const transport = { inputs, intermediates, outputs };
				const job = factoryLayoutInput.parse({
					...request,
					width: 64,
					height: 64,
					nativePlan: true,
					fixedPlan: true,
					inputs: request.inputs.map(({ item, perMinute }) => ({ item, perMinute })),
					outputs: [{ item: 'electronic-circuit', perMinute: 90 }],
					transport,
					logistics: {
						requester: 'requester-chest',
						provider: 'storage-chest',
						buffer: 'buffer-chest'
					}
				});
				const result = await compileFactoryLayout(job, z.json().parse(mixedTransportPack), modules);
				assert.equal(
					result.steps.reduce((sum, s) => sum + s.machines, 0),
					3
				);
				assert.ok(
					blueprintInputSchema.safeParse({ ...result.design, operation: 'create' }).success
				);
				assert.ok(
					result.test.inputs.every((p) => p.name === 'iron-plate' || p.name === 'copper-plate')
				);
				for (const port of result.test.inputs) {
					assert.equal(
						result.design.entities[port.entity - 1]?.name,
						inputs === 'belts' ? 'transport-belt' : 'requester-chest'
					);
				}
				for (const port of result.test.outputs) {
					const entity = result.design.entities[port.entity - 1];
					assert.equal(entity?.name, outputs === 'belts' ? 'transport-belt' : 'storage-chest');
					if (outputs === 'storage-chests')
						assert.equal(
							entity?.request_filters?.sections[0]?.filters[0]?.name,
							'electronic-circuit'
						);
				}

				const reachableTiles = new Set<string>();
				for (const e of result.design.entities) {
					const model =
						mixedTransportPack.machines[e.name] ??
						mixedTransportPack.chests[e.name] ??
						mixedTransportPack.belts[e.name] ??
						mixedTransportPack.undergrounds[e.name] ??
						mixedTransportPack.splitters[e.name];
					if (!model) continue;
					const [width, height] = model.size;
					for (let x = Math.floor(e.position.x - width / 2); x < e.position.x + width / 2; x++)
						for (let y = Math.floor(e.position.y - height / 2); y < e.position.y + height / 2; y++)
							reachableTiles.add(`${x},${y}`);
				}
				for (const e of result.design.entities.filter((e) => e.name === 'fast-inserter')) {
					for (const [custom, normal] of [
						[e.pickup_position, [-0, -1]],
						[e.drop_position, [0, 1.2]]
					] as const) {
						let [x, y] = custom ? [custom.x, custom.y] : normal;
						if (!custom) for (let turn = 0; turn < (e.direction ?? 0); turn += 4) [x, y] = [-y, x];
						assert.ok(
							reachableTiles.has(`${Math.floor(e.position.x + x)},${Math.floor(e.position.y + y)}`),
							'Every inserter must pick up from and drop into a machine, chest or belt'
						);
					}
				}
				const buffers = result.design.entities.filter((e) => e.name === 'buffer-chest');
				assert.equal(buffers.length > 0, intermediates === 'buffer-chests');
				if (intermediates === 'buffer-chests') {
					assert.ok(
						result.design.entities
							.filter((e) => e.name === 'requester-chest')
							.every((e) => e.request_filters?.request_from_buffers === true)
					);
				}
				assert.ok(
					result.design.entities.every(
						(e) => e.position.x >= 0 && e.position.y >= 0 && e.position.x < 64 && e.position.y < 64
					)
				);
			});

test('compact buffer cells use less space without changing production or transport', async () => {
	const job = factoryLayoutInput.parse({
		...request,
		width: 64,
		height: 64,
		nativePlan: true,
		fixedPlan: true,
		inputs: request.inputs.map(({ item, perMinute }) => ({ item, perMinute })),
		outputs: [{ item: 'electronic-circuit', perMinute: 90 }],
		transport: {
			inputs: 'requester-chests',
			intermediates: 'buffer-chests',
			outputs: 'storage-chests'
		},
		logistics: { requester: 'requester-chest', provider: 'storage-chest', buffer: 'buffer-chest' }
	});
	const compact = await compileFactoryLayout(job, z.json().parse(mixedTransportPack), modules);
	const spacious = await compileFactoryLayout(
		{ ...job, layout: { ...job.layout, spacing: 'spacious' } },
		z.json().parse(mixedTransportPack),
		modules
	);
	assert.deepEqual(compact.steps, spacious.steps);
	const area = (result: typeof compact) => {
		const machines = result.design.entities.filter((e) => e.name === 'assembling-machine-2');
		return (
			(Math.max(...machines.map((e) => e.position.x)) -
				Math.min(...machines.map((e) => e.position.x)) +
				3) *
			(Math.max(...machines.map((e) => e.position.y)) -
				Math.min(...machines.map((e) => e.position.y)) +
				3)
		);
	};
	assert.ok(area(compact) < area(spacious));
});

for (const intermediates of ['belts', 'buffer-chests'] as const)
	test(`complete blue-circuit plan with requester inputs, ${intermediates} inside and storage outputs`, {
		timeout: 30000
	}, async () => {
		const fixture = JSON.parse(
			readFileSync('tests/fixtures/interpose/saved-processing-units-60-2.1.21.json', 'utf8')
		);
		fixture.pack.chests['buffer-chest'] = { size: [1, 1], mode: 'buffer', capacity: 48 };
		const request = factoryLayoutInput.parse({
			...fixture.request,
			layout: { shape: 'square', spacing: 'compact' },
			transport: { inputs: 'requester-chests', intermediates, outputs: 'storage-chests' },
			logistics: { requester: 'requester-chest', provider: 'storage-chest', buffer: 'buffer-chest' }
		});
		const result = await compileFactoryLayout(request, z.json().parse(fixture.pack), modules);
		assert.equal(result.steps.length, 26);
		assert.equal(
			result.steps.reduce((sum, s) => sum + s.machines, 0),
			60
		);
		for (const input of result.test.inputs)
			if (input.kind === 'item')
				assert.equal(result.design.entities[input.entity - 1]?.name, 'requester-chest');
		for (const output of result.test.outputs)
			if (output.kind === 'item')
				assert.equal(result.design.entities[output.entity - 1]?.name, 'storage-chest');
		if (intermediates === 'belts')
			for (const output of result.test.outputs) {
				const chest = result.design.entities[output.entity - 1];
				assert.ok(chest);
				assert.ok(
					result.design.entities.some(
						(e) =>
							e.name === 'aai-fast-loader' &&
							e.type === 'input' &&
							e.direction === 8 &&
							e.position.x === chest.position.x &&
							e.position.y === chest.position.y - 1
					)
				);
				assert.ok(
					result.design.entities.some(
						(e) =>
							e.name === 'fast-transport-belt' &&
							e.direction === 8 &&
							e.position.x === chest.position.x &&
							e.position.y === chest.position.y - 2
					),
					'Loader intake must receive from a straight belt, never a side feed'
				);
			}

		assert.ok(result.test.inputs.every((p) => request.inputs.some((q) => q.item === p.name)));
		assert.ok(Math.abs(result.test.outputs.reduce((sum, p) => sum + p.perMinute, 0) - 60) < 1e-6);
		assert.ok(blueprintInputSchema.safeParse({ ...result.design, operation: 'create' }).success);
	});

test('saved 900 scrap/min plan collects all thirteen products from six rectangular recyclers', async () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/interpose/scrap-recycling-2.1.21.json', 'utf8')
	);
	const job = factoryLayoutInput.parse(fixture.request);
	const result = await compileFactoryLayout(job, z.json().parse(fixture.pack), modules);
	const explicit = await compileFactoryLayout(
		factoryLayoutInput.parse({
			...fixture.request,
			transport: { inputs: 'requester-chests', intermediates: 'belts', outputs: 'storage-chests' }
		}),
		z.json().parse(fixture.pack),
		modules
	);
	assert.deepEqual(
		explicit.design.entities,
		result.design.entities,
		'Unused internal belt preference must preserve the qualified chest-fed design'
	);
	assert.deepEqual(explicit.test, result.test);
	assert.equal(job.outputs.length, 13);
	assert.equal(result.design.entities.filter((e) => e.name === 'recycler').length, 6);
	assert.equal(new Set(result.test.outputs.map((p) => p.name)).size, 13);
	assert.ok(Math.abs(result.test.inputs.reduce((n, p) => n + p.perMinute, 0) - 900) < 1e-6);
	const expected = new Map(job.outputs.map((p) => [p.item, p.perMinute]));
	for (const name of expected.keys())
		assert.ok(
			Math.abs(
				result.test.outputs.filter((p) => p.name === name).reduce((n, p) => n + p.perMinute, 0) -
					(expected.get(name) ?? 0)
			) < 1e-6
		);
	// The recycler ejects north. Its output chest must receive directly, with the input arm south.
	for (const machine of result.design.entities.filter((e) => e.name === 'recycler')) {
		const vector = fixture.pack.furnaces.recycler.result_position;
		const x = Math.floor(machine.position.x + vector[0]) + 0.5,
			y = Math.floor(machine.position.y + vector[1]) + 0.5;
		assert.ok(
			result.design.entities.some(
				(e) => e.name === 'passive-provider-chest' && e.position.x === x && e.position.y === y
			)
		);
	}
	assert.ok(blueprintInputSchema.safeParse({ ...result.design, operation: 'create' }).success);
	assert.equal(
		factoryLayoutInput.safeParse({
			...job,
			outputs: Array.from({ length: 33 }, (_, i) => ({ item: 'product-' + i, perMinute: 1 }))
		}).success,
		false
	);
});

test('saved uranium chain sorts all four products and routes the complete 100 by 100 plan', {
	timeout: 30000
}, async () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/interpose/saved-uranium-2.1.21.json', 'utf8')
	);
	const input = factoryLayoutInput.parse(fixture.request);
	const result = await compileFactoryLayout(input, z.json().parse(fixture.pack), modules);
	const occupied = new Set<string>();
	for (const entity of result.design.entities) {
		const key = `${entity.position.x},${entity.position.y}`;
		assert.ok(!occupied.has(key), `Overlapping entities at ${key}`);
		occupied.add(key);
	}
	assert.equal(result.steps.length, 15);
	assert.equal(result.test.startupItems.length, 11);
	assert.equal(
		result.test.startupItems.reduce((sum, item) => sum + item.count, 0),
		660
	);
	for (const item of result.test.startupItems) {
		assert.equal(item.name, 'uranium-235');
		assert.equal(result.design.entities[item.entity - 1]?.recipe, 'kovarex-enrichment-process');
	}
	const exports = result.design.entities.filter(
		(e) =>
			e.override_stack_size === 1 &&
			(e.control_behavior?.circuit_condition as { comparator?: string } | undefined)?.comparator ===
				'>'
	);
	assert.equal(exports.length, 11);
	assert.ok(exports.every((e) => (e.pickup_position?.x ?? 0) < 0));
	assert.equal(
		result.design.entities.filter(
			(e) =>
				e.override_stack_size === 1 &&
				(e.control_behavior?.circuit_condition as { comparator?: string } | undefined)
					?.comparator === '<'
		).length,
		11
	);
	assert.ok(exports.every((e) => e.control_behavior?.circuit_enabled === true));
	assert.equal(result.design.entities.filter((e) => e.recipe === 'uranium-processing').length, 31);
	assert.equal(
		result.design.entities.filter((e) => e.recipe === 'kovarex-enrichment-process').length,
		11
	);
	for (const product of ['uranium-235', 'uranium-238', 'iron-ore', 'stone'])
		assert.ok(
			result.design.entities.some(
				(e) => e.use_filters && e.filters?.some((f) => f.name === product)
			)
		);
	assert.deepEqual(
		result.test.outputs.map((p) => [p.name, p.perMinute]),
		[
			['production-science-pack', 60],
			['uranium-fuel-cell', 6]
		]
	);
	assert.ok(result.test.inputs.every((p) => input.inputs.some((q) => q.item === p.name)));
	for (const e of result.design.entities) {
		assert.ok(e.position.x >= 0 && e.position.x < 100 && e.position.y >= 0 && e.position.y < 100);
	}
	assert.ok(blueprintInputSchema.safeParse({ ...result.design, operation: 'create' }).success);
});
