// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import type { ManagedServer } from '../src/lib/server/db/schema';

type Query = { op: string; tool?: string; args?: Record<string, unknown> };
const replies = new Map<string, unknown>();
mock.module('../src/lib/server/factory-query', () => ({
	factoryQuery: (_server: ManagedServer, request: Query) => {
		const lookup =
			request.tool === 'planning_recipes'
				? `${request.tool}:${request.args?.type}:${request.args?.product}`
				: request.tool;
		if (!lookup || !replies.has(lookup)) throw new Error(`Unexpected lookup: ${lookup}`);
		return Promise.resolve(replies.get(lookup));
	}
}));
const { planFactory } = await import('../src/lib/server/factory-planning');
const server = {} as ManagedServer;

test('plans a modded chain with exact base-speed machine counts and measured gap', async () => {
	replies.clear();
	replies.set('planning_recipes:item:widget', {
		force: 'player',
		product: 'widget',
		total: 1,
		truncated: false,
		recipes: [
			{
				name: 'widget-from-plate',
				enabled: true,
				hidden: false,
				energy: 2,
				ingredients: [{ name: 'plate', type: 'item', amount: 3 }],
				products: [{ name: 'widget', type: 'item', amount: 2 }],
				productivity_bonus: 0,
				machines: [
					{ name: 'assembler', speed: 1, availability: 'craftable' },
					{ name: 'foundry', speed: 4, availability: 'unavailable' }
				],
				machines_total: 2
			}
		]
	});
	replies.set('planning_recipes:item:plate', {
		force: 'player',
		product: 'plate',
		total: 0,
		truncated: false,
		recipes: {}
	});
	replies.set('item_rate', {
		found: true,
		produced_per_min: 12,
		consumed_per_min: 4,
		net_per_min: 8
	});
	const plan = await planFactory(server, {
		force: 'player',
		surface: 'nauvis',
		product: 'widget',
		per_min: 60
	});
	assert.equal(plan.status, 'complete');
	assert.deepEqual(plan.inputs, [{ name: 'plate', type: 'item', per_min: 90 }]);
	assert.equal(plan.steps[0]?.crafts_per_min, 30);
	assert.equal(plan.steps[0]?.machines, 1);
	assert.equal(plan.measured?.gap_per_min, 48);
	const unavailable = await planFactory(server, {
		force: 'player',
		surface: 'nauvis',
		product: 'widget',
		per_min: 60,
		machines: { 'widget-from-plate': 'foundry' }
	});
	assert.equal(unavailable.status, 'needs_choices');
	assert.equal(unavailable.steps[0]?.machines, undefined);
	assert.deepEqual(
		unavailable.machine_choices[0]?.machines.map(({ name }) => name),
		['assembler']
	);
});

test('returns unlocked recipe choices rather than guessing', async () => {
	replies.clear();
	replies.set('planning_recipes:item:widget', {
		force: 'player',
		product: 'widget',
		total: 2,
		truncated: false,
		recipes: ['widget-a', 'widget-b'].map((name) => ({
			name,
			enabled: true,
			hidden: false,
			energy: 1,
			ingredients: {},
			products: [{ name: 'widget', type: 'item', amount: 1 }],
			productivity_bonus: 0,
			machines: {},
			machines_total: 0
		}))
	});
	replies.set('item_rate', {
		found: true,
		produced_per_min: 0,
		consumed_per_min: 0,
		net_per_min: 0
	});
	const plan = await planFactory(server, {
		force: 'player',
		surface: 'nauvis',
		product: 'widget',
		per_min: 60
	});
	assert.equal(plan.status, 'needs_choices');
	assert.deepEqual(
		plan.choices[0]?.recipes.map(({ name }) => name),
		['widget-a', 'widget-b']
	);
	assert.equal(plan.steps.length, 0);
});

test('cycles stop at a declared external input instead of recursing forever', async () => {
	replies.clear();
	for (const [product, ingredient] of [
		['widget', 'intermediate'],
		['intermediate', 'widget']
	]) {
		replies.set(`planning_recipes:item:${product}`, {
			force: 'player',
			product,
			total: 1,
			truncated: false,
			recipes: [
				{
					name: `make-${product}`,
					enabled: true,
					hidden: false,
					energy: 1,
					ingredients: [{ name: ingredient, type: 'item', amount: 1 }],
					products: [{ name: product, type: 'item', amount: 1 }],
					productivity_bonus: 0,
					machines: [{ name: 'assembler', speed: 1, availability: 'owned' }],
					machines_total: 1
				}
			]
		});
	}
	replies.set('item_rate', {
		found: true,
		produced_per_min: 0,
		consumed_per_min: 0,
		net_per_min: 0
	});
	const plan = await planFactory(server, {
		force: 'player',
		surface: 'nauvis',
		product: 'widget',
		per_min: 60
	});
	assert.equal(plan.status, 'limited');
	assert.deepEqual(plan.inputs, [{ name: 'widget', type: 'item', per_min: 60 }]);
	assert.match(plan.issues.join(' '), /cycle/);
});

test('intrinsic machine productivity changes ingredient and machine counts', async () => {
	replies.clear();
	replies.set('planning_recipes:item:plate', {
		force: 'player',
		product: 'plate',
		total: 1,
		truncated: false,
		enabled_total: 1,
		enabled_shown: 1,
		recipes: [
			{
				name: 'smelt-plate',
				enabled: true,
				hidden: false,
				energy: 1,
				ingredients: [{ name: 'ore', type: 'item', amount: 1 }],
				products: [{ name: 'plate', type: 'item', amount: 1 }],
				productivity_bonus: 0,
				machines: [
					{
						name: 'foundry',
						speed: 4,
						availability: 'owned',
						productivity_bonus: 0.5,
						products: [{ name: 'plate', type: 'item', amount: 1.5 }]
					}
				],
				machines_total: 1
			}
		]
	});
	replies.set('planning_recipes:item:ore', {
		force: 'player',
		product: 'ore',
		total: 0,
		truncated: false,
		recipes: {}
	});
	replies.set('item_rate', {
		found: true,
		produced_per_min: 0,
		consumed_per_min: 0,
		net_per_min: 0
	});
	const plan = await planFactory(server, {
		force: 'player',
		surface: 'nauvis',
		product: 'plate',
		per_min: 60
	});
	assert.equal(plan.status, 'complete');
	assert.equal(plan.steps[0]?.crafts_per_min, 40);
	assert.deepEqual(plan.inputs, [{ name: 'ore', type: 'item', per_min: 40 }]);
});
