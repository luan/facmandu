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
	type: z.enum(['item', 'fluid']).optional(),
	position: position.optional(),
	direction: z.literal([0, 4, 8, 12]).optional(),
	perMinute: z.number().min(0.01).max(60000)
});

// Platforms and modules need qualified templates before enabling them.
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
		nativePlan: z.boolean().default(false),
		logistics: z.strictObject({ requester: name, provider: name }).optional(),
		tiers: z.strictObject({
			machine: name,
			crafters: z.array(name).max(8).optional(),
			belt: name,
			underground: name,
			inserter: name,
			pole: name,
			pipe: name.optional(),
			pipe_underground: name.optional(),
			furnace: name.optional(),
			splitter: name.optional(),
			long_inserter: name.optional()
		})
	})
	.transform((request) => ({
		...request,
		// Defaults follow the current row templates until the engine exposes row endpoints.
		// Pin ports for fixed world connections; native throughput still gates every draft.
		inputs: request.inputs.map((port, index) => ({
			...port,
			position: port.position ?? { x: 0.5, y: 0.5 + index * 3 },
			direction: port.direction ?? (4 as const)
		})),
		outputs: request.outputs.map((port, index) => ({
			...port,
			position: port.position ?? {
				x:
					request.recipes.length === 1 && request.outputs.length === 1
						? Math.max(5.5, request.width - 7.5)
						: 5.5 + index * 3,
				y: request.height - 0.5
			},
			direction: port.direction ?? (8 as const)
		}))
	}))
	.superRefine((request, ctx) => {
		if (
			!request.nativePlan &&
			request.logistics &&
			(request.recipes.length !== 1 || request.outputs.length !== 1)
		)
			ctx.addIssue({
				code: 'custom',
				message:
					'Logistics cells use one recipe with external supplies; use separate cells for intermediates'
			});
		if (!request.nativePlan && request.outputs.some((port) => port.type === 'fluid'))
			ctx.addIssue({
				code: 'custom',
				message: 'Fluid-output production needs a qualified template'
			});
		if (request.nativePlan && request.recipes.length > 24)
			ctx.addIssue({ code: 'custom', message: 'Native plans support at most 24 selected recipes' });
		if (
			request.nativePlan &&
			[...request.inputs, ...request.outputs].some((p) => p.type !== 'fluid') &&
			!request.logistics
		)
			ctx.addIssue({
				code: 'custom',
				message: 'Native plan item supplies require requester/provider chests'
			});
		if (
			(request.nativePlan || request.inputs.some((port) => port.type === 'fluid')) &&
			(!request.tiers.pipe || !request.tiers.pipe_underground)
		)
			ctx.addIssue({
				code: 'custom',
				message: 'Fluid plans require pipe and pipe_underground tiers'
			});
		if (request.nativePlan) {
			for (const ports of [request.inputs, request.outputs]) {
				const products = new Set<string>();
				for (const port of ports) {
					const product = `${port.type ?? 'item'}/${port.item}`;
					if (products.has(product))
						ctx.addIssue({
							code: 'custom',
							message: 'Native plans require one budget per product'
						});
					products.add(product);
				}
			}
		}
		const occupied = new Set<string>();
		for (const port of [...request.inputs, ...request.outputs]) {
			const tile = `${port.position.x},${port.position.y}`;
			if (occupied.has(tile))
				ctx.addIssue({ code: 'custom', message: 'Ports must occupy distinct tiles' });
			occupied.add(tile);
			if (port.position.x >= request.width || port.position.y >= request.height)
				ctx.addIssue({ code: 'custom', message: 'Ports must be inside the factory block' });
		}
	});
export type FactoryLayoutInput = z.infer<typeof factoryLayoutInput>;
export const factoryLayoutJsonSchema = z.toJSONSchema(factoryLayoutInput, { io: 'input' });
