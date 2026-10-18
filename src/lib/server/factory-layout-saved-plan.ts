import { z } from 'zod';
import { type FactoryLayoutInput, factoryLayoutJobInput } from '$lib/factory-layout';
import { ServerError } from './server-files';

const rate = z
	.object({
		name: z.string(),
		type: z.enum(['item', 'fluid', 'entity']),
		perMinute: z.number().nonnegative().optional(),
		temperature: z.number().finite().optional()
	})
	.passthrough();
const rates = z.union([z.array(rate), z.strictObject({}).transform(() => [])]);
const line = z
	.object({
		recipe: z.string(),
		machine: z.string(),
		machines: z.number().finite().nonnegative(),
		active: z.boolean().optional()
	})
	.passthrough();
export const layoutPlanSnapshot = z.object({
	reference: z.string(),
	revision: z.number().int().nonnegative(),
	force: z.string(),
	surface: z.string(),
	name: z.string(),
	valid: z.boolean(),
	status: z.string(),
	lines: z.array(line).min(1).max(256),
	products: rates,
	ingredients: rates,
	byproducts: rates
});

// Only planner output crosses this boundary. The layout engine gets no authority
// to choose recipes, substitutes or machine counts.
export function resolveFactoryLayout(input: FactoryLayoutInput, value: unknown) {
	const plan = layoutPlanSnapshot.parse(value);
	if (plan.force !== input.force || plan.reference !== input.reference)
		throw new ServerError(403, 'Plan belongs to another force or reference');
	if (plan.revision !== input.expectedRevision)
		throw new ServerError(409, 'Plan revision changed; read it again before laying it out');
	if (!plan.valid || plan.status !== 'solved')
		throw new ServerError(409, 'Finish or repair the plan in the planner before laying it out');
	const lines = plan.lines.filter((line) => line.active !== false && line.machines > 0.000001);
	if (!lines.length) throw new ServerError(400, 'This plan has no active machines to lay out');
	const machines: Record<string, string> = {};
	for (const line of lines) {
		if (line.quality !== undefined && line.quality !== 'normal')
			throw new ServerError(
				400,
				'Layout does not yet support this saved quality; plan was not modified'
			);
		if (
			(line.modules && typeof line.modules === 'object' && Object.keys(line.modules).length > 0) ||
			line.beacon ||
			line.fuel
		)
			throw new ServerError(
				400,
				'Layout does not yet support saved modules, beacons or fuel; plan was not modified'
			);
		if (machines[line.recipe] && machines[line.recipe] !== line.machine)
			throw new ServerError(
				400,
				'Recipe lines with different machines need separate layout blocks'
			);
		machines[line.recipe] = line.machine;
	}
	const ports = (rows: z.infer<typeof rate>[]) =>
		rows
			.filter((row) => row.type !== 'entity' && (row.perMinute ?? 0) > 0.000001)
			.map((row) => ({
				item: row.name,
				type: row.type === 'fluid' ? ('fluid' as const) : ('item' as const),
				perMinute: row.perMinute,
				temperature: row.type === 'fluid' ? row.temperature : undefined
			}));
	const first = lines[0];
	if (!first) throw new ServerError(400, 'Plan has no machines');
	const job = factoryLayoutJobInput.parse({
		force: input.force,
		surface: plan.surface,
		label: input.label ?? plan.name,
		width: input.width,
		height: input.height,
		layout: input.layout,
		logistics: input.logistics,
		inputs: ports(plan.ingredients),
		outputs: ports([...plan.products, ...plan.byproducts]),
		recipes: Object.keys(machines),
		fixedPlan: true,
		nativePlan:
			!!input.logistics ||
			[...plan.products, ...plan.byproducts].some((p) => p.type === 'fluid') ||
			lines.some(
				(line) =>
					Array.isArray(line.products) &&
					line.products.some(
						(p) => typeof p === 'object' && p !== null && 'type' in p && p.type === 'fluid'
					)
			),
		tiers: {
			...input.tiers,
			machine: first.machine,
			crafters: [...new Set(lines.map((line) => line.machine))].filter(
				(name) => name !== first.machine
			)
		}
	});
	return { job, plan: { ...plan, lines } };
}

export function layoutFailureMessage(cause: unknown) {
	if (cause instanceof z.ZodError)
		return [...new Set(cause.issues.map((issue) => issue.message))].join(' · ').slice(0, 500);
	return cause instanceof Error
		? cause.message.replace(/^.*?:\d+: /u, '').slice(0, 500)
		: 'Could not generate this layout. Try again.';
}
