import { z } from 'zod';
import { blueprintCircuitSchema } from '#lib/blueprints.js';
import type { ManagedServer } from './db/schema';
import { factoryBlueprint } from './factory-blueprints';
import { ServerError } from './server-files';

const combinators = new Set([
	'constant-combinator',
	'arithmetic-combinator',
	'decider-combinator',
	'selector-combinator'
]);
const peripherals = new Set([
	'container',
	'logistic-container',
	'lamp',
	'electric-pole',
	'display-panel',
	'programmable-speaker',
	'power-switch'
]);
export function resolveCircuitDesign(input: unknown, catalog: unknown) {
	const design = blueprintCircuitSchema.parse(input);
	const prototypes = z
		.object({
			entities: z.array(
				z.object({
					name: z.string(),
					type: z.string().optional(),
					unlocked: z.boolean().optional()
				})
			)
		})
		.parse(catalog).entities;
	let logic = false;
	for (const entity of design.entities) {
		const prototype = prototypes.find((p) => p.name === entity.name);
		if (!prototype?.type || (!combinators.has(prototype.type) && !peripherals.has(prototype.type)))
			throw new ServerError(
				400,
				`Circuit modules cannot include ${entity.name}; use the production layout engine for factories`
			);
		if (!prototype.unlocked)
			throw new ServerError(409, `Circuit entity is not unlocked: ${entity.name}`);
		logic ||= combinators.has(prototype.type);
	}
	if (!logic) throw new ServerError(400, 'A circuit module needs at least one combinator');
	return { ...design, tiles: [], operation: 'create' as const };
}
export async function factoryCircuit(
	server: ManagedServer,
	input: unknown,
	player?: { name: string; requireAdmin: boolean }
) {
	const design = blueprintCircuitSchema.parse(input);
	const catalog = await factoryBlueprint(
		server,
		{
			operation: 'catalog',
			force: design.force,
			names: [...new Set(design.entities.map((e) => e.name))]
		},
		player
	);
	return factoryBlueprint(server, resolveCircuitDesign(design, catalog), player);
}
