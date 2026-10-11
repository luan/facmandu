import { z } from 'zod';
import { factoryImageSchema } from './factory-images';

const name = z.string().min(1).max(200);
const coordinate = z.number().min(-10000).max(10000).multipleOf(0.5);
export const blueprintEntitySchema = z.strictObject({
	name,
	position: z.strictObject({ x: coordinate, y: coordinate }),
	direction: z.union([z.literal(0), z.literal(4), z.literal(8), z.literal(12)]).default(0),
	recipe: name.optional(),
	type: z.enum(['input', 'output']).optional()
});
export const blueprintTileSchema = z.strictObject({
	name,
	position: z.strictObject({
		x: z.number().int().min(-10000).max(10000),
		y: z.number().int().min(-10000).max(10000)
	})
});
// Modules, wires and trains need explicit settings and native validation before being added.
export const blueprintDesignSchema = z.strictObject({
	force: name,
	label: z.string().min(1).max(120),
	entities: z.array(blueprintEntitySchema).max(200).default([]),
	tiles: z.array(blueprintTileSchema).max(1024).default([])
});
export const blueprintTargetSchema = blueprintDesignSchema.extend({
	surface: name,
	position: z
		.strictObject({
			x: z.number().int().min(-1000000).max(1000000),
			y: z.number().int().min(-1000000).max(1000000)
		})
		.describe(
			'Integer world offset added to every entity position; not the blueprint cursor center'
		)
});
export const blueprintRequestSchema = z
	.discriminatedUnion('operation', [
		z.strictObject({
			operation: z.literal('catalog'),
			force: name,
			names: z.array(name).min(1).max(40)
		}),
		blueprintDesignSchema.extend({ operation: z.literal('create') }),
		blueprintTargetSchema.extend({ operation: z.literal('inspect') }),
		blueprintTargetSchema.extend({
			operation: z.literal('place'),
			expectedTick: z.number().int().nonnegative(),
			expectedDesign: z.string().regex(/^[a-f0-9]{64}$/)
		})
	])
	.refine(
		(input) => input.operation === 'catalog' || input.entities.length + input.tiles.length > 0,
		'A blueprint needs entities or tiles'
	);
export type BlueprintRequest = z.infer<typeof blueprintRequestSchema>;
export const blueprintArtifactSchema = z
	.object({
		kind: z.literal('blueprint'),
		image: factoryImageSchema.optional(),
		renderError: z.string().optional(),
		label: z.string(),
		blueprint: z.string().startsWith('0'),
		entities: z
			.array(
				blueprintEntitySchema.extend({
					width: z.number().positive(),
					height: z.number().positive()
				})
			)
			.max(200)
			.default([]),
		tiles: z.array(blueprintTileSchema).max(1024).default([]),
		warnings: z.array(z.string()).default([]),
		cost: z.array(z.object({ name: z.string(), count: z.number().positive() }))
	})
	.refine(
		(input) => input.entities.length + input.tiles.length > 0,
		'A blueprint needs entities or tiles'
	);
export type BlueprintArtifact = z.infer<typeof blueprintArtifactSchema>;
