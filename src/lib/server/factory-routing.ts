import * as v from 'valibot';
import { z } from 'zod';
import {
	blueprintArtifactSchema,
	blueprintEntitySchema,
	MAX_BLUEPRINT_ENTITIES
} from '$lib/blueprints';
import type { ManagedServer } from './db/schema';
import { factoryBlueprint } from './factory-blueprints';
import { factoryQuery } from './factory-query';

const name = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const coordinate = v.pipe(v.number(), v.finite(), v.minValue(-1000000), v.maxValue(1000000));
export const beltRouteInput = v.object({
	force: name,
	surface: name,
	belt: name,
	underground: v.optional(name),
	x: coordinate,
	y: coordinate,
	target_x: coordinate,
	target_y: coordinate,
	margin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64))),
	label: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(90)))
});
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
const endpoint = z.object({
	name: z.string(),
	ghost: z.boolean(),
	unit_number: z.number().int().positive(),
	position,
	direction: z.number().int()
});
const routeReply = z.discriminatedUnion('found', [
	z.object({
		found: z.literal(false),
		surface: z.string(),
		reason: z.string().optional(),
		note: z.string().optional(),
		visited: z.number().optional()
	}),
	z.object({
		found: z.literal(true),
		force: z.string(),
		surface: z.string(),
		tick: z.number().int().nonnegative(),
		visited: z.number().int().nonnegative(),
		entities: z
			.union([
				z.array(blueprintEntitySchema.extend({ position })).max(MAX_BLUEPRINT_ENTITIES),
				z.object({}).strict()
			])
			.transform((value) => (Array.isArray(value) ? value : [])),
		start: endpoint.optional(),
		destination: endpoint.optional(),
		note: z.string()
	})
]);

export async function designBeltRoute(
	server: ManagedServer,
	input: v.InferOutput<typeof beltRouteInput>
) {
	const reply = routeReply.parse(
		await factoryQuery(server, { op: 'call', tool: 'route_belt', args: input })
	);
	if (!reply.found) return { ...reply, placed: false as const };
	const origin = { x: Math.floor(input.x), y: Math.floor(input.y) };
	const { entities, ...facts } = reply;
	if (!entities.length)
		return { ...facts, position: origin, placed: false as const, alreadyConnected: true as const };
	const draft = blueprintArtifactSchema.parse(
		await factoryBlueprint(server, {
			operation: 'create',
			force: reply.force,
			label: input.label ?? 'Belt connection',
			entities: entities.map((entity) => ({
				...entity,
				position: { x: entity.position.x - origin.x, y: entity.position.y - origin.y }
			}))
		})
	);
	return { ...facts, position: origin, placed: false as const, draft };
}
