import { z } from 'zod';
import { factoryImagePendingSchema, factoryImageSchema } from './factory-images';

const name = z.string().min(1).max(200);
// A connected mine-to-bus expansion can exceed 200 entities. Keep one bounded
// blueprint; increase this only after native placement and rendering benchmarks.
export const MAX_BLUEPRINT_ENTITIES = 1000;
const coordinate = z.number().min(-10000).max(10000).multipleOf(0.5);
const vector = z.strictObject({ x: z.number().min(-64).max(64), y: z.number().min(-64).max(64) });
const wire = z.tuple([
	z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES),
	z.number().int().min(1).max(65535),
	z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES),
	z.number().int().min(1).max(65535)
]);
export const blueprintEntitySchema = z.strictObject({
	name,
	position: z.strictObject({ x: coordinate, y: coordinate }),
	direction: z.literal([0, 4, 8, 12]).default(0),
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
	entities: z.array(blueprintEntitySchema).max(MAX_BLUEPRINT_ENTITIES).default([]),
	tiles: z.array(blueprintTileSchema).max(1024).default([])
});
const entityRows = z
	.array(
		z.strictObject({
			entity: blueprintEntitySchema.omit({ wires: true }),
			count: z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES),
			step: z.strictObject({ x: coordinate, y: coordinate })
		})
	)
	.min(1)
	.max(MAX_BLUEPRINT_ENTITIES)
	.describe(
		'Repeat an entity along a row: copy 0 uses entity.position, copy n adds n * step. Use for straight belts, pipes and machine rows. Settings and relative inserter reach are retained. Wire individually after expansion.'
	);
export const blueprintRowsSchema = blueprintDesignSchema
	.extend({
		operation: z.literal('create'),
		entityRows
	})
	.refine(
		(input) =>
			input.entities.length + input.entityRows.reduce((sum, row) => sum + row.count, 0) <=
			MAX_BLUEPRINT_ENTITIES,
		`Expanded blueprint exceeds ${MAX_BLUEPRINT_ENTITIES} entities`
	);

export function expandBlueprintRows(input: z.infer<typeof blueprintRowsSchema>): BlueprintRequest {
	const { entityRows, ...design } = input;
	return blueprintRequestSchema.parse({
		...design,
		entities: [
			...design.entities,
			...entityRows.flatMap(({ entity, count, step }) =>
				Array.from({ length: count }, (_, index) => ({
					...entity,
					position: { x: entity.position.x + index * step.x, y: entity.position.y + index * step.y }
				}))
			)
		]
	});
}
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
const outputTarget = z.strictObject({
	x: z.number().min(-1000000).max(1000000),
	y: z.number().min(-1000000).max(1000000)
});
const buildCheck = {
	operation: z.literal('check'),
	measure: z.boolean().default(false),
	item: name,
	outputs: z.array(outputTarget).max(16).default([])
};
export const buildOutputSampleSchema = z.strictObject({
	tick: z.number().int().nonnegative(),
	item: name,
	outputs: z
		.array(
			z.strictObject({
				unit_number: z.number().int().positive(),
				count: z.number().int().nonnegative()
			})
		)
		.min(1)
		.max(16)
});
export type BuildOutputSample = z.infer<typeof buildOutputSampleSchema>;
export function measureBuildOutput(before: BuildOutputSample, after: BuildOutputSample) {
	const ticks = after.tick - before.tick;
	if (
		before.item !== after.item ||
		before.outputs.length !== after.outputs.length ||
		before.outputs.some((output, index) => output.unit_number !== after.outputs[index]?.unit_number)
	)
		return { measured: false as const, reason: 'Output destinations changed; take a new baseline' };
	if (ticks <= 0)
		return {
			measured: false as const,
			reason: 'Game clock did not advance; take a new baseline after a save reload'
		};
	const delivered =
		after.outputs.reduce((total, output) => total + output.count, 0) -
		before.outputs.reduce((total, output) => total + output.count, 0);
	if (before.outputs.some((output, index) => (after.outputs[index]?.count ?? -1) < output.count))
		return {
			measured: false as const,
			reason: 'An output inventory decreased; use destinations that retain the sampled items'
		};
	if (ticks < 1800)
		return {
			measured: false as const,
			reason: 'Sample less than 30 game seconds; check again after 30 game seconds',
			elapsed_ticks: ticks
		};
	return {
		measured: true as const,
		delivered,
		elapsed_ticks: ticks,
		per_min: (delivered * 3600) / ticks,
		basis:
			'Net accumulation in destination inventories; withdrawals can undercount delivery, outside deposits can overcount it'
	};
}
export const blueprintRequestSchema = z
	.discriminatedUnion('operation', [
		z.strictObject({
			operation: z.literal('catalog'),
			force: name,
			names: z.array(name).min(1).max(40)
		}),
		blueprintDesignSchema.extend({ operation: z.literal('create') }),
		blueprintTargetSchema.extend({ operation: z.literal('inspect') }),
		blueprintTargetSchema.extend(buildCheck),
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
		...buildCheck,
		surface: name,
		position: blueprintTargetSchema.shape.position
	}),
	designReference.extend({
		operation: z.literal('create'),
		label: z.string().min(1).max(120).optional(),
		parts: z
			.array(
				z.strictObject({
					designId: designReference.shape.designId,
					offset: blueprintTargetSchema.shape.position
				})
			)
			.max(16)
			.describe(
				'Append saved sections without retransmitting their geometry. Offset is section world position minus this draft world position. Wires and settings are preserved.'
			)
			.default([]),
		entityChanges: z
			.array(
				z.strictObject({
					index: z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES),
					changes: entityPatch
				})
			)
			.max(MAX_BLUEPRINT_ENTITIES)
			.default([]),
		removedEntityIndices: z
			.array(z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES))
			.max(MAX_BLUEPRINT_ENTITIES)
			.default([]),
		addedEntities: z.array(blueprintEntitySchema).max(MAX_BLUEPRINT_ENTITIES).default([]),
		addedEntityRows: entityRows.optional()
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
export function combineBlueprintDesigns(
	base: z.infer<typeof blueprintDesignSchema>,
	parts: ReadonlyArray<{
		design: z.infer<typeof blueprintDesignSchema>;
		offset: z.infer<typeof blueprintTargetSchema.shape.position>;
	}>
) {
	const entities = [...base.entities];
	const wires = [...base.wires];
	const tiles = [...base.tiles];
	for (const { design, offset } of parts) {
		if (design.force !== base.force) throw new Error('Blueprint section belongs to another force');
		const count = entities.length;
		const shiftWire = (connection: z.infer<typeof wire>): z.infer<typeof wire> => {
			if (connection[0] > design.entities.length || connection[2] > design.entities.length)
				throw new Error('Blueprint section wire refers outside its section');
			return [connection[0] + count, connection[1], connection[2] + count, connection[3]];
		};
		entities.push(
			...design.entities.map((entity) => ({
				...entity,
				position: { x: entity.position.x + offset.x, y: entity.position.y + offset.y },
				wires: entity.wires?.map(shiftWire)
			}))
		);
		wires.push(...design.wires.map(shiftWire));
		tiles.push(
			...design.tiles.map((tile) => ({
				...tile,
				position: { x: tile.position.x + offset.x, y: tile.position.y + offset.y }
			}))
		);
	}
	return blueprintDesignSchema.parse({ ...base, entities, wires, tiles });
}
export function reviseBlueprintDesign(
	saved: z.infer<typeof blueprintDesignSchema>,
	revision: Extract<z.infer<typeof blueprintReferenceSchema>, { operation: 'create' }>
): BlueprintRequest {
	if (saved.force !== revision.force) throw new Error('Blueprint draft belongs to another force');
	const removed = new Set(revision.removedEntityIndices);
	for (const index of removed)
		if (!saved.entities[index - 1]) throw new Error('Removed entity index is outside this draft');
	const entities = saved.entities.map((entity) => ({ ...entity }));
	for (const patch of revision.entityChanges) {
		if (!entities[patch.index - 1]) throw new Error('Entity patch index is outside this draft');
		if (removed.has(patch.index)) throw new Error('Cannot patch and remove the same entity');
		entities[patch.index - 1] = blueprintEntitySchema.parse({
			...entities[patch.index - 1],
			...patch.changes
		});
	}
	const indices = new Map<number, number>();
	for (let index = 1; index <= entities.length; index++)
		if (!removed.has(index)) indices.set(index, indices.size + 1);
	const remapWire = (connection: z.infer<typeof wire>): z.infer<typeof wire>[] => {
		const from = indices.get(connection[0]);
		const to = indices.get(connection[2]);
		return from && to ? [[from, connection[1], to, connection[3]]] : [];
	};
	const revised = {
		...saved,
		label: revision.label ?? saved.label,
		operation: 'create',
		wires: saved.wires.flatMap(remapWire),
		entities: [
			...entities.flatMap((entity, index) =>
				removed.has(index + 1) ? [] : [{ ...entity, wires: entity.wires?.flatMap(remapWire) }]
			),
			...revision.addedEntities
		]
	};
	return revision.addedEntityRows
		? expandBlueprintRows(
				blueprintRowsSchema.parse({ ...revised, entityRows: revision.addedEntityRows })
			)
		: blueprintRequestSchema.parse(revised);
}
export const blueprintInputSchema = z.union([
	blueprintRequestSchema,
	blueprintReferenceSchema,
	blueprintRowsSchema
]);
export type BlueprintRequest = z.infer<typeof blueprintRequestSchema>;
export const blueprintArtifactSchema = z
	.object({
		kind: z.literal('blueprint'),
		designId: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		image: factoryImageSchema.or(factoryImagePendingSchema).optional(),
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
			.max(MAX_BLUEPRINT_ENTITIES)
			.default([]),
		tiles: z.array(blueprintTileSchema).max(1024).default([]),
		warnings: z.array(z.string()).default([]),
		inserter_transfers: z
			.array(
				z.object({
					inserter: z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES),
					pickup: z.object({ x: z.number(), y: z.number() }),
					drop: z.object({ x: z.number(), y: z.number() }),
					pickup_entity: z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES).optional(),
					drop_entity: z.number().int().min(1).max(MAX_BLUEPRINT_ENTITIES).optional(),
					drop_belt_side: z.enum(['left', 'right', 'center']).optional(),
					belt_lane_items_per_second: z.number().positive().optional()
				})
			)
			.max(MAX_BLUEPRINT_ENTITIES)
			.default([]),
		cost: z.array(z.object({ name: z.string(), count: z.number().positive() }))
	})
	.refine(
		(input) => input.entities.length + input.tiles.length > 0,
		'A blueprint needs entities or tiles'
	);
export type BlueprintArtifact = z.infer<typeof blueprintArtifactSchema>;
