import { z } from 'zod';

const name = z.string().min(1).max(200);
const tile = z.number().int().min(0).max(100);
const position = z.strictObject({
	x: z
		.number()
		.min(0.5)
		.max(99.5)
		.refine((n) => n % 1 === 0.5, 'Use tile centers'),
	y: z
		.number()
		.min(0.5)
		.max(99.5)
		.refine((n) => n % 1 === 0.5, 'Use tile centers')
});
const port = z.strictObject({
	item: name,
	position,
	direction: z.literal([0, 4, 8, 12]),
	perMinute: z.number().min(0.01).max(60000)
});

// Fluids, platforms and modules need qualified layout templates before enabling them.
export const factoryLayoutInput = z
	.strictObject({
		force: name,
		surface: name,
		label: z.string().min(1).max(120),
		width: tile.min(8),
		height: tile.min(8),
		inputs: z.array(port).min(1).max(12),
		outputs: z.array(port).min(1).max(6),
		recipes: z.array(name).min(1).max(64),
		tiers: z.strictObject({
			machine: name,
			belt: name,
			underground: name,
			inserter: name,
			pole: name,
			furnace: name.optional(),
			splitter: name.optional(),
			long_inserter: name.optional()
		})
	})
	.superRefine((request, ctx) => {
		for (const port of [...request.inputs, ...request.outputs]) {
			if (port.position.x >= request.width || port.position.y >= request.height)
				ctx.addIssue({ code: 'custom', message: 'Ports must be inside the factory block' });
		}
	});
export type FactoryLayoutInput = z.infer<typeof factoryLayoutInput>;
export const factoryLayoutJsonSchema = z.toJSONSchema(factoryLayoutInput, { io: 'input' });
