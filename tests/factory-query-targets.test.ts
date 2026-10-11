import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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
