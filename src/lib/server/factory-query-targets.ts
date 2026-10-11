import { z } from 'zod';

const targetSchema = z.object({
	name: z.string(),
	unit_number: z.number().int().positive().optional(),
	x: z.number(),
	y: z.number()
});
const discoverySchema = z.object({
	force: z.string(),
	surface: z.string(),
	entities: z.array(targetSchema)
});
export type FactoryTargets = Record<string, z.infer<typeof targetSchema>>;
const key = (force: unknown, surface: unknown, unit: unknown) =>
	JSON.stringify([force, surface, unit]);

export function rememberFactoryTargets(previous: FactoryTargets, result: unknown): FactoryTargets {
	const discovery = discoverySchema.safeParse(result);
	if (!discovery.success) return previous;
	const targets = new Map(Object.entries(previous));
	for (const entity of discovery.data.entities) {
		if (!entity.unit_number) continue;
		const id = key(discovery.data.force, discovery.data.surface, entity.unit_number);
		targets.delete(id);
		targets.set(id, entity);
	}
	// Keep 500 targets per request; extend only if bounded discovery needs a wider working area.
	return Object.fromEntries([...targets].slice(-500));
}

export function resolveFactoryTarget(
	args: Record<string, string | number | boolean>,
	targets: FactoryTargets
) {
	if (args.x !== undefined || args.y !== undefined || typeof args.unit_number !== 'number')
		return args;
	const target = targets[key(args.force, args.surface, args.unit_number)];
	if (!target || (args.name !== undefined && args.name !== target.name)) return args;
	// This supplies observed coordinates, not authority: native inspection rechecks the exact ID.
	return { ...args, x: target.x, y: target.y };
}

export function prepareFactoryLookup(
	query: { tool: string; args: Record<string, string | number | boolean> },
	tools: Record<string, { params?: Record<string, string> }>,
	targets: FactoryTargets,
	playerForce?: string
) {
	const tool = tools[query.tool];
	if (!tool)
		return { tool: query.tool, ok: false as const, error: `Unknown factory lookup: ${query.tool}` };
	for (const key of Object.keys(query.args))
		if (key !== 'force' && !tool.params?.[key])
			return {
				tool: query.tool,
				ok: false as const,
				error: `Unknown argument: ${key}. Parameters for ${query.tool}: ${JSON.stringify(tool.params ?? {})}`
			};
	let args = { ...query.args };
	if (playerForce) {
		if (args.force && args.force !== playerForce)
			return { tool: query.tool, ok: false as const, error: 'Use your own force' };
		if (tool.params?.force) args.force = playerForce;
	}
	if (query.tool.startsWith('inspect_')) args = resolveFactoryTarget(args, targets);
	return { tool: query.tool, ok: true as const, args };
}
