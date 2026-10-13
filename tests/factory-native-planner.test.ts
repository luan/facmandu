import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as v from 'valibot';
import { nativeFactoryPlanInput, savedFactoryPlanInput } from '../src/lib/factory-plan-input';

const scope = {
	force: 'player',
	player: 'Alice',
	reference: 'toby://plan/1/42',
	expectedRevision: 3
};
test('saved planner edits retain native settings and reject unknown, unbounded or ambiguous values', () => {
	const patch = {
		modules: [{ name: 'speed-module', quality: 'normal', count: 2 }],
		beacon: { name: 'beacon', count: 1, modules: [{ name: 'speed-module', count: 2 }] },
		constraint: { count: 1.5, mode: 'maximum' },
		temperatures: { steam: 165 },
		active: false
	};
	assert.deepEqual(
		v.parse(savedFactoryPlanInput, { operation: 'edit_line', ...scope, lineId: 7, patch }),
		{ operation: 'edit_line', ...scope, lineId: 7, patch }
	);
	for (const invalid of [
		{ unknown: true },
		{ modules: [{ name: 'speed-module', count: 1.5 }] },
		{ beacon: { name: 'beacon', count: 1001 } },
		{ temperatures: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`fluid${i}`, 165])) },
		{ constraint: { count: -1, mode: 'exact' } },
		{}
	])
		assert.equal(
			v.safeParse(savedFactoryPlanInput, {
				operation: 'edit_line',
				...scope,
				lineId: 7,
				patch: invalid
			}).success,
			false
		);
	assert.equal(
		v.safeParse(savedFactoryPlanInput, { operation: 'edit_line', ...scope, lineId: 0, patch })
			.success,
		false
	);
	assert.equal(
		v.safeParse(savedFactoryPlanInput, { operation: 'nest_line', ...scope, lineId: 7 }).success,
		true
	);
});
test('planner targets preserve fluid temperatures and reject item temperatures and dual goals', () => {
	const product = { name: 'steam', type: 'fluid', temperature: 165, perMinute: 60 };
	assert.deepEqual(
		v.parse(savedFactoryPlanInput, { operation: 'set_products', ...scope, products: [product] }),
		{ operation: 'set_products', ...scope, products: [product] }
	);
	const plan = {
		force: 'player',
		player: 'Alice',
		surface: 'nauvis',
		products: [product],
		recipes: [{ name: 'steam', constraint: { count: 2, mode: 'exact' }, fuel: { name: 'coal' } }]
	};
	assert.deepEqual(v.parse(nativeFactoryPlanInput, plan), plan);
	for (const target of [
		{ ...product, type: 'item' },
		{ ...product, machineCount: 2 },
		{ ...product, temperature: Infinity }
	])
		assert.equal(
			v.safeParse(nativeFactoryPlanInput, { ...plan, products: [target] }).success,
			false
		);
	assert.equal(
		v.safeParse(savedFactoryPlanInput, { operation: 'set_products', ...scope, products: [] })
			.success,
		true
	);
});

test('input-led plans accept native belt and power supplies without mixing quantity units', () => {
	const plan = {
		force: 'player',
		player: 'Alice',
		surface: 'nauvis',
		products: [],
		recipes: [{ name: 'iron-plate', machine: 'electric-furnace' }],
		inputs: [
			{
				name: 'iron-ore',
				type: 'item',
				beltCount: 1.5,
				belt: 'transport-belt',
				beltStack: 1,
				mode: 'maximum'
			},
			{ name: 'custom-electric-power', type: 'entity', watts: 1000000, mode: 'maximum' }
		],
		maximize: { name: 'iron-plate', type: 'item' }
	};
	assert.deepEqual(v.parse(nativeFactoryPlanInput, plan), plan);
	for (const input of [
		{ ...plan.inputs[0], perMinute: 900 },
		{ ...plan.inputs[0], type: 'fluid' },
		{ ...plan.inputs[0], beltStack: 1.5 },
		{ ...plan.inputs[0], beltCount: Infinity },
		{ ...plan.inputs[1], perMinute: 60 },
		{ ...plan.inputs[1], type: 'item' },
		{ ...plan.inputs[1], temperature: 165 },
		{ ...plan.inputs[1], watts: -1 }
	])
		assert.equal(v.safeParse(nativeFactoryPlanInput, { ...plan, inputs: [input] }).success, false);
	assert.equal(
		v.safeParse(nativeFactoryPlanInput, {
			...plan,
			products: [{ name: 'custom-electric-power', type: 'entity', watts: 1000000 }]
		}).success,
		true
	);
});

test('nested block and recipe edits require saved scope, revisions and stable IDs', () => {
	const settings = {
		linked: false,
		mode: 'input',
		products: [],
		inputs: [{ name: 'iron-ore', type: 'item', perMinute: 900, mode: 'maximum' }],
		maximize: { name: 'iron-plate', type: 'item' }
	};
	for (const operation of [
		{ operation: 'edit_block', floorId: 8, settings },
		{ operation: 'edit_block', floorId: 8, settings: false },
		{
			operation: 'add_line',
			floorId: 8,
			recipe: { name: 'iron-plate', constraint: { count: 2, mode: 'exact' } }
		},
		{ operation: 'move_line', lineId: 7, floorId: 8, afterLineId: 9 },
		{ operation: 'remove_line', lineId: 7 }
	]) {
		const request = { ...scope, ...operation };
		assert.deepEqual(v.parse(savedFactoryPlanInput, request), request);
		assert.equal(
			v.safeParse(savedFactoryPlanInput, { ...request, expectedRevision: -1 }).success,
			false
		);
		assert.equal(
			v.safeParse(savedFactoryPlanInput, { ...request, reference: 'toby://plan/1/0' }).success,
			false
		);
	}
	for (const invalid of [
		{ ...settings, unknown: true },
		{ ...settings, mode: 'guess' },
		{ ...settings, products: [{ name: 'iron-plate', type: 'item', machineCount: 2 }] }
	])
		assert.equal(
			v.safeParse(savedFactoryPlanInput, {
				operation: 'edit_block',
				...scope,
				floorId: 8,
				settings: invalid
			}).success,
			false
		);
});
