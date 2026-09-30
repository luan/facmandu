import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import { factoryQuery } from './factory-query';
import { ServerError } from './server-files';

const material = z.object({
	name: z.string(),
	type: z.enum(['item', 'fluid']),
	amount: z.number().nonnegative()
});
// Factorio's JSON helper sends an empty Lua array as {}.
const wireArray = <T extends z.ZodType>(item: T) =>
	z.preprocess(
		(value) =>
			value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
				? []
				: value,
		z.array(item)
	);
const machine = z.object({
	name: z.string(),
	speed: z.number().positive(),
	availability: z.enum(['owned', 'craftable', 'unavailable', 'unknown']),
	productivity_bonus: z.number().default(0),
	products: wireArray(material).optional()
});
const recipe = z.object({
	name: z.string(),
	enabled: z.boolean(),
	hidden: z.boolean(),
	energy: z.number().positive(),
	ingredients: wireArray(material),
	products: wireArray(material),
	productivity_bonus: z.number(),
	constrained: z.boolean().default(false),
	machines: wireArray(machine),
	machines_total: z.number()
});
const recipeReply = z.object({
	force: z.string(),
	product: z.string(),
	recipes: wireArray(recipe),
	total: z.number(),
	truncated: z.boolean(),
	enabled_total: z.number().default(0),
	enabled_shown: z.number().default(0)
});
const rateReply = z.object({
	found: z.boolean(),
	produced_per_min: z.coerce.number().optional(),
	consumed_per_min: z.coerce.number().optional(),
	net_per_min: z.coerce.number().optional()
});

export const factoryPlanInput = z.object({
	force: z.string().min(1),
	surface: z.string().min(1),
	product: z.string().min(1),
	type: z.enum(['item', 'fluid']).default('item'),
	per_min: z.number().positive().finite().max(1e9),
	window: z
		.enum([
			'five_seconds',
			'one_minute',
			'ten_minutes',
			'one_hour',
			'ten_hours',
			'fifty_hours',
			'two_hundred_fifty_hours',
			'one_thousand_hours'
		])
		.default('one_minute'),
	recipes: z.record(z.string(), z.string()).default({}),
	machines: z.record(z.string(), z.string()).default({})
});
export type FactoryPlanInput = z.input<typeof factoryPlanInput>;
type Product = z.infer<typeof material>;
type Rate = { name: string; type: Product['type']; per_min: number };

const key = (product: Pick<Product, 'name' | 'type'>) => `${product.type}:${product.name}`;
const rounded = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export type FactoryPlan = {
	kind: 'factory_plan';
	status: 'complete' | 'needs_choices' | 'limited';
	force: string;
	surface: string;
	window: string;
	target: Rate;
	assumptions: string[];
	steps: Array<{
		recipe: string;
		product: string;
		crafts_per_min: number;
		machine?: string;
		machines?: number;
		ingredients: Rate[];
		products: Rate[];
	}>;
	inputs: Rate[];
	outputs: Rate[];
	choices: Array<{
		product: string;
		type: Product['type'];
		recipes: Array<{ name: string; enabled: boolean }>;
	}>;
	machine_choices: Array<{ recipe: string; machines: Array<z.infer<typeof machine>> }>;
	issues: string[];
	measured?: {
		produced_per_min: number;
		consumed_per_min: number;
		net_per_min: number;
		gap_per_min: number;
	};
};

// This is a gross-input bill. Byproducts are reported separately; recycling
// them across branches requires a production-flow solver, not a tree walk.
export async function planFactory(
	server: ManagedServer,
	rawInput: FactoryPlanInput
): Promise<FactoryPlan> {
	const input = factoryPlanInput.parse(rawInput);
	const result: FactoryPlan = {
		kind: 'factory_plan',
		status: 'complete',
		force: input.force,
		surface: input.surface,
		window: input.window,
		target: { name: input.product, type: input.type, per_min: input.per_min },
		assumptions: [
			'Normal quality',
			'Base machine speed, no modules or beacons',
			'Machine availability means owned now or an enabled placement-item recipe; unknown placement methods need review',
			'Expected recipe yields include force recipe and chosen machine base productivity',
			'Crafting requirements only; power, fuel, transport, and raw resource extraction are not sized',
			'Gross inputs; byproducts are listed as outputs and are not recycled'
		],
		steps: [],
		inputs: [],
		outputs: [],
		choices: [],
		machine_choices: [],
		issues: []
	};
	const lookedUp = new Map<string, z.infer<typeof recipeReply>>();
	const inputs = new Map<string, Rate>();
	const outputs = new Map<string, Rate>();
	const active = new Set<string>();
	let lookups = 0;
	const add = (target: Map<string, Rate>, product: Product, amount: number) => {
		const id = key(product);
		const prior = target.get(id);
		target.set(id, {
			name: product.name,
			type: product.type,
			per_min: (prior?.per_min ?? 0) + amount
		});
	};
	const resolve = async (product: Product, amount: number, depth: number): Promise<void> => {
		const id = key(product);
		if (depth > 16 || active.has(id)) {
			result.status = 'limited';
			result.issues.push(
				`Recipe cycle or depth limit at ${product.name}; this branch needs an external input or another recipe`
			);
			add(inputs, product, amount);
			return;
		}
		let reply = lookedUp.get(id);
		if (!reply) {
			if (++lookups > 32) {
				result.status = 'limited';
				result.issues.push('Stopped after 32 recipe lookups; narrow the plan or specify inputs');
				add(inputs, product, amount);
				return;
			}
			reply = recipeReply.parse(
				await factoryQuery(server, {
					op: 'call',
					tool: 'planning_recipes',
					args: { force: input.force, product: product.name, type: product.type }
				})
			);
			lookedUp.set(id, reply);
		}
		if (reply.enabled_total > reply.enabled_shown) {
			result.status = 'limited';
			result.issues.push(`Unlocked recipe choices for ${product.name} were truncated`);
			return;
		}
		const enabled = reply.recipes.filter((candidate) => candidate.enabled);
		const selected = input.recipes[id] ?? input.recipes[product.name];
		const chosen = selected
			? enabled.find((candidate) => candidate.name === selected)
			: enabled.length === 1
				? enabled[0]
				: undefined;
		if (!chosen) {
			if (selected) result.issues.push(`Recipe ${selected} is unavailable for ${product.name}`);
			if (reply.recipes.length === 0 || enabled.length === 0) {
				add(inputs, product, amount);
				if (depth === 0) {
					result.status = 'limited';
					result.issues.push(`No unlocked crafting recipe for ${product.name}`);
				}
			} else {
				if (result.status !== 'limited') result.status = 'needs_choices';
				result.choices.push({
					product: product.name,
					type: product.type,
					recipes: reply.recipes.map(({ name, enabled }) => ({ name, enabled }))
				});
			}
			return;
		}
		if (chosen.machines_total > chosen.machines.length) {
			result.status = 'limited';
			result.issues.push(`Machine choices for ${chosen.name} were truncated`);
			return;
		}
		const selectedMachine = input.machines[chosen.name];
		const usableMachines = chosen.machines.filter(
			(candidate) => candidate.availability !== 'unavailable'
		);
		const machineChoice = selectedMachine
			? usableMachines.find(
					(candidate) => candidate.name === selectedMachine && candidate.availability !== 'unknown'
				)
			: usableMachines.length === 1 && usableMachines[0]?.availability !== 'unknown'
				? usableMachines[0]
				: undefined;
		if (selectedMachine && !machineChoice)
			result.issues.push(
				`Machine ${selectedMachine} is unavailable or has unknown placement for ${chosen.name}`
			);
		if (!machineChoice) {
			if (usableMachines.length > 0) {
				if (result.status !== 'limited') result.status = 'needs_choices';
				result.machine_choices.push({ recipe: chosen.name, machines: usableMachines });
			} else {
				result.status = 'limited';
				result.issues.push(`No available compatible crafting machine found for ${chosen.name}`);
			}
			return;
		}
		if (machineChoice.productivity_bonus !== 0 && !machineChoice.products) {
			result.status = 'limited';
			result.issues.push(`Missing intrinsic productivity yields for ${machineChoice.name}`);
			return;
		}
		const made = machineChoice.products ?? chosen.products;
		const yieldPerCraft = made
			.filter((part) => key(part) === id)
			.reduce((sum, part) => sum + part.amount, 0);
		if (yieldPerCraft <= 0) {
			result.status = 'limited';
			result.issues.push(`Recipe ${chosen.name} has no usable yield for ${product.name}`);
			return;
		}
		const crafts = amount / yieldPerCraft;
		if (chosen.constrained) {
			result.status = 'limited';
			result.issues.push(
				`Recipe ${chosen.name} has fluid temperature or item quality constraints that this plan does not model`
			);
		}
		const step: FactoryPlan['steps'][number] = {
			recipe: chosen.name,
			product: product.name,
			crafts_per_min: rounded(crafts),
			machine: machineChoice.name,
			machines: rounded((crafts * chosen.energy) / (60 * machineChoice.speed)),
			ingredients: chosen.ingredients.map((part) => ({
				name: part.name,
				type: part.type,
				per_min: rounded(part.amount * crafts)
			})),
			products: made.map((part) => ({
				name: part.name,
				type: part.type,
				per_min: rounded(part.amount * crafts)
			}))
		};
		result.steps.push(step);
		active.add(id);
		for (const part of made) if (key(part) !== id) add(outputs, part, part.amount * crafts);
		for (const part of chosen.ingredients) await resolve(part, part.amount * crafts, depth + 1);
		active.delete(id);
	};
	await resolve({ name: input.product, type: input.type, amount: 0 }, input.per_min, 0);
	result.inputs = [...inputs.values()]
		.map((rate) => ({ ...rate, per_min: rounded(rate.per_min) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	result.outputs = [...outputs.values()]
		.map((rate) => ({ ...rate, per_min: rounded(rate.per_min) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	if (result.outputs.some((out) => inputs.has(key(out)))) {
		result.status = 'limited';
		result.issues.push(
			'Some byproducts could feed listed inputs; gross input totals do not deduct them'
		);
	}
	const rateTool = input.type === 'item' ? 'item_rate' : 'fluid_rate';
	const rateArgs = {
		force: input.force,
		surface: input.surface,
		window: input.window,
		[input.type === 'item' ? 'item' : 'fluid']: input.product
	};
	const measured = rateReply.parse(
		await factoryQuery(server, { op: 'call', tool: rateTool, args: rateArgs })
	);
	if (!measured.found) throw new ServerError(404, `Unknown surface: ${input.surface}`);
	const produced = measured.produced_per_min ?? 0;
	const consumed = measured.consumed_per_min ?? 0;
	result.measured = {
		produced_per_min: produced,
		consumed_per_min: consumed,
		net_per_min: measured.net_per_min ?? produced - consumed,
		gap_per_min: rounded(input.per_min - produced)
	};
	return result;
}
