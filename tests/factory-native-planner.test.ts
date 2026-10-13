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
		false
	);
});
