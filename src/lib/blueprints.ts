import { z } from 'zod';

const name = z.string().min(1).max(200);
const coordinate = z.number().min(-10000).max(10000).multipleOf(0.5);
export const blueprintEntitySchema = z.strictObject({
	name,
	position: z.strictObject({ x: coordinate, y: coordinate }),
	direction: z.union([z.literal(0), z.literal(4), z.literal(8), z.literal(12)]).default(0),
	recipe: name.optional(),
	type: z.enum(['input', 'output']).optional()
});
// Standard production entities only. Add trains, modules and wires with native validation when needed.
export const blueprintDesignSchema = z.strictObject({
	force: name,
	label: z.string().min(1).max(120),
	entities: z.array(blueprintEntitySchema).min(1).max(200)
});
export const blueprintTargetSchema = blueprintDesignSchema.extend({
	surface: name,
	position: z.strictObject({
		x: z.number().int().min(-1000000).max(1000000),
		y: z.number().int().min(-1000000).max(1000000)
	})
});
export const blueprintRequestSchema = z.discriminatedUnion('operation', [
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
]);
export type BlueprintRequest = z.infer<typeof blueprintRequestSchema>;
export const blueprintArtifactSchema = z.object({
	kind: z.literal('blueprint'),
	label: z.string(),
	blueprint: z.string().startsWith('0'),
	entities: z
		.array(
			blueprintEntitySchema.extend({ width: z.number().positive(), height: z.number().positive() })
		)
		.min(1)
		.max(200),
	cost: z.array(z.object({ name: z.string(), count: z.number().positive() }))
});
export type BlueprintArtifact = z.infer<typeof blueprintArtifactSchema>;
