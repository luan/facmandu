// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { expect, test } from 'bun:test';
import type * as v from 'valibot';
import { designBeltRoutes } from '../src/lib/server/belt-route-batch';
import type { beltRoutesInput } from '../src/lib/server/factory-routing';
import { ServerError } from '../src/lib/server/server-files';

const input = {
	force: 'player',
	surface: 'nauvis',
	belt: 'transport-belt',
	avoid: [{ designId: 'a'.repeat(64), position: { x: 10, y: 20 } }],
	connections: [
		{ x: 0.5, y: 0.5, target_x: 8.5, target_y: 0.5, label: 'Ore' },
		{ x: 0.5, y: 2.5, target_x: 8.5, target_y: 2.5, label: 'Sand' },
		{ x: 0.5, y: 4.5, target_x: 8.5, target_y: 4.5, label: 'Glass' }
	]
} satisfies v.InferOutput<typeof beltRoutesInput>;

test('routing reserves completed paths and retains partial results in order', async () => {
	let call = 0;
	const result = await designBeltRoutes(input, (request) => {
		call++;
		expect(request.avoid?.map((part) => part.designId)).toEqual(
			call === 1 ? ['a'.repeat(64)] : ['a'.repeat(64), 'b'.repeat(64)]
		);
		if (call === 2) throw new ServerError(400, 'An endpoint is occupied');
		if (call === 3)
			return Promise.resolve({
				found: false,
				surface: 'nauvis',
				placed: false,
				reason: 'No charted path'
			});
		return Promise.resolve({
			found: true,
			force: 'player',
			surface: 'nauvis',
			tick: 1,
			visited: 9,
			position: { x: 0, y: 0 },
			placed: false,
			note: 'Draft',
			draft: {
				kind: 'blueprint',
				force: 'player',
				label: 'Ore',
				designId: 'b'.repeat(64),
				blueprint: '0test',
				entities: [],
				tiles: [],
				cost: [],
				inserter_transfers: [],
				warnings: []
			}
		});
	});
	expect(result.map((entry) => [entry.connection, entry.label, entry.found])).toEqual([
		[1, 'Ore', true],
		[2, 'Sand', false],
		[3, 'Glass', false]
	]);
	expect(result[1]).toMatchObject({ error: 'An endpoint is occupied', placed: false });
	expect(input.avoid?.length).toBe(1);
});

test('a changed permission or disconnected player stops further route reads', async () => {
	let calls = 0;
	await expect(
		designBeltRoutes(input, () => {
			calls++;
			throw new ServerError(403, 'This chat belongs to another force');
		})
	).rejects.toThrow('This chat belongs to another force');
	expect(calls).toBe(1);
});
