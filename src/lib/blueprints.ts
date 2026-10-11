import { z } from 'zod';
import { factoryImageSchema } from './factory-images';

const name = z.string().min(1).max(200);
const coordinate = z.number().min(-10000).max(10000).multipleOf(0.5);
const vector = z.strictObject({ x: z.number().min(-64).max(64), y: z.number().min(-64).max(64) });
const wire = z.tuple([
	z.number().int().min(1).max(200),
	z.number().int().min(1).max(65535),
	z.number().int().min(1).max(200),
	z.number().int().min(1).max(65535)
]);
export const blueprintEntitySchema = z.strictObject({
	name,
	position: z.strictObject({ x: coordinate, y: coordinate }),
	direction: z.union([z.literal(0), z.literal(4), z.literal(8), z.literal(12)]).default(0),
	recipe: name.optional(),
	type: z.enum(['input', 'output']).optional(),
	filters: z
		.array(
			z.strictObject({
				index: z.number().int().min(1).max(1000),
				name,
				quality: name.optional(),
				comparator: z.enum(['=', '≠', '<', '>', '≤', '≥']).optional()
			})
		)
		.max(100)
		.optional(),
	'chunk-filter': z
		.array(z.strictObject({ index: z.number().int().min(1).max(1000), name }))
		.max(100)
		.describe(
			'Static asteroid-collector chunk filters; circuit-controlled filters use control_behavior.circuit_set_filters instead'
		)
		.optional(),
	use_filters: z.boolean().optional(),
	filter_mode: z.enum(['whitelist', 'blacklist']).optional(),
	pickup_position: vector
		.describe('Inserter pickup vector relative to its center, not world coordinates')
		.optional(),
	drop_position: vector
		.describe('Inserter drop vector relative to its center, not world coordinates')
		.optional(),
	override_stack_size: z.number().int().min(0).max(255).optional(),
	control_behavior: z
		.record(z.string().min(1).max(100), z.json())
		.describe(
			'Native blueprint format, not runtime LuaControlBehavior fields. Read blueprint_operation catalog examples: collector circuit_set_filters (not set_filter); constant combinator sections.sections[].filters (not control_behavior.filters).'
		)
		.optional(),
	wires: z
		.array(wire)
		.max(100)
		.describe(
			'Native tuples [source entity index, source connector id, target entity index, target connector id]. Entity indices are 1-based positions in entities.'
		)
		.optional()
});
export const blueprintTileSchema = z.strictObject({
	name,
	position: z.strictObject({
		x: z.number().int().min(-10000).max(10000),
		y: z.number().int().min(-10000).max(10000)
	})
});
// Modules and train schedules need explicit request/settings support before being added.
export const blueprintDesignSchema = z.strictObject({
	force: name,
	wires: z.array(wire).max(1000).default([]),
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
const designReference = z.strictObject({
	designId: z.string().regex(/^[a-f0-9]{64}$/),
	force: name
});
const entityPatch = blueprintEntitySchema
	.partial()
	.extend({ direction: blueprintEntitySchema.shape.direction.removeDefault().optional() });
export const blueprintReferenceSchema = z.discriminatedUnion('operation', [
	designReference.extend({
		operation: z.literal('create'),
		label: z.string().min(1).max(120).optional(),
		entityChanges: z
			.array(z.strictObject({ index: z.number().int().min(1).max(200), changes: entityPatch }))
			.max(200)
			.default([]),
		addedEntities: z.array(blueprintEntitySchema).max(200).default([])
	}),
	designReference.extend({
		operation: z.literal('inspect'),
		surface: name,
		position: blueprintTargetSchema.shape.position
	}),
	designReference.extend({
		operation: z.literal('place'),
		surface: name,
		position: blueprintTargetSchema.shape.position,
		expectedTick: z.number().int().nonnegative(),
		expectedDesign: z.string().regex(/^[a-f0-9]{64}$/)
	})
]);
export const blueprintInputSchema = z.union([blueprintRequestSchema, blueprintReferenceSchema]);
export type BlueprintRequest = z.infer<typeof blueprintRequestSchema>;
export const blueprintArtifactSchema = z
	.object({
		kind: z.literal('blueprint'),
		designId: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
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
