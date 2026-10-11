import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	prepareFactoryLookup,
	rememberFactoryTargets,
	resolveFactoryTarget
} from '../src/lib/server/factory-query-targets';

const target = { name: 'transport-belt', unit_number: 7, x: 0.5, y: -0.5 };
const args = { force: 'player', surface: 'nauvis', unit_number: 7 };

test('discovered IDs resolve to exact coordinates only within their observed scope', () => {
	const targets = rememberFactoryTargets(
		{},
		{ force: 'player', surface: 'nauvis', entities: [target] }
	);
	assert.deepEqual(resolveFactoryTarget(args, targets), { ...args, x: 0.5, y: -0.5 });
	for (const changed of [
		{ ...args, force: 'enemy' },
		{ ...args, surface: 'gleba' },
		{ ...args, name: 'steel-chest' },
		{ ...args, unit_number: 8 },
		{ ...args, x: 2 },
		{ ...args, x: 2, y: 3 }
	])
		assert.deepEqual(resolveFactoryTarget(changed, targets), changed);
});

test('target memory is bounded and ignores unidentified entities', () => {
	const targets = rememberFactoryTargets(
		{},
		{
			force: 'player',
			surface: 'nauvis',
			entities: [
				{ name: 'transport-belt', x: 0.5, y: -0.5 },
				...Array.from({ length: 501 }, (_, index) => ({ ...target, unit_number: index + 1 }))
			]
		}
	);
	assert.equal(Object.keys(targets).length, 500);
	assert.deepEqual(resolveFactoryTarget({ ...args, unit_number: 1 }, targets), {
		...args,
		unit_number: 1
	});
	assert.deepEqual(resolveFactoryTarget({ ...args, unit_number: 501 }, targets), {
		...args,
		unit_number: 501,
		x: 0.5,
		y: -0.5
	});
});

test('independent batch queries retain valid reads while refusing invalid names, parameters and forces', () => {
	const tools = {
		game_time: { params: { force: 'string!' } },
		inspect_transport: {
			params: {
				force: 'string!',
				surface: 'string!',
				unit_number: 'number',
				x: 'number',
				y: 'number'
			}
		}
	};
	const targets = rememberFactoryTargets(
		{},
		{ force: 'player', surface: 'nauvis', entities: [target] }
	);
	const inputs: Parameters<typeof prepareFactoryLookup>[0][] = [
		{ tool: 'game_time', args: {} },
		{ tool: 'invented_lookup', args: {} },
		{ tool: 'game_time', args: { force: 'enemy' } },
		{ tool: 'game_time', args: { invented: true } },
		{ tool: 'inspect_transport', args }
	];
	const prepared = inputs.map((query) => prepareFactoryLookup(query, tools, targets, 'player'));
	assert.deepEqual(
		prepared.map((query) => query.ok),
		[true, false, false, false, true]
	);
	assert.deepEqual(prepared[0], { tool: 'game_time', ok: true, args: { force: 'player' } });
	assert.deepEqual(prepared[4], {
		tool: 'inspect_transport',
		ok: true,
		args: { ...args, x: 0.5, y: -0.5 }
	});
	assert.deepEqual(inputs[0]?.args, {});
});
