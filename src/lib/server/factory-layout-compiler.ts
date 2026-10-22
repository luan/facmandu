import { spawn } from 'node:child_process';
import { z } from 'zod';
import { blueprintDesignSchema, MAX_BLUEPRINT_ENTITIES } from '$lib/blueprints';
import { type FactoryLayoutJob, factoryLayoutJobInput } from '$lib/factory-layout';
import adapter from './factory-layout-adapter.lua?raw';
import belts from './factory-layout-belts.lua?raw';
import compression from './factory-layout-compress.lua?raw';
import interfaces from './factory-layout-interfaces.lua?raw';
import logistics from './factory-layout-logistics.lua?raw';
import options from './factory-layout-options.lua?raw';
import nativePlan from './factory-layout-plan.lua?raw';
import source from './factory-layout-worker.lua?raw';
import { luaString } from './factory-query-bundle';
import { ServerError } from './server-files';

const resultSchema = z.object({
	entities: blueprintDesignSchema.shape.entities,
	wires: blueprintDesignSchema.shape.wires,
	tiles: blueprintDesignSchema.shape.tiles,
	inputs: z.array(
		z.object({
			item: z.string(),
			type: z.enum(['item', 'fluid']).optional(),
			perMinute: z.number()
		})
	),
	steps: z.array(z.object({ recipe: z.string(), machines: z.number(), perMinute: z.number() })),
	ports: z.array(
		z.object({
			entity: z.number().int().positive(),
			item: z.string(),
			kind: z.enum(['input', 'output']),
			position: z.object({ x: z.number(), y: z.number() }),
			perMinute: z.number().positive().optional()
		})
	),
	warnings: z.array(z.json())
});

// Values are Lua data literals, never executable model text.
function luaData(value: unknown): string {
	if (value === null || value === undefined) return 'nil';
	if (typeof value === 'string') return luaString(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return `{${value.map(luaData).join(',')}}`;
	if (typeof value === 'object')
		return `{${Object.entries(value)
			.map(([key, entry]) => `[ ${luaString(key)} ]=${luaData(entry)}`)
			.join(',')}}`;
	throw new ServerError(400, 'Invalid compiler data');
}

export async function compileFactoryLayout(
	input: FactoryLayoutJob,
	pack: z.infer<ReturnType<typeof z.json>>,
	modules: Record<string, string>,
	signal?: AbortSignal
) {
	const transport = z
		.object({
			transport: z
				.object({
					underground: z.string(),
					splitter: z.string().optional(),
					long_inserter: z.string().optional()
				})
				.optional()
		})
		.parse(pack).transport;
	const request = factoryLayoutJobInput.parse({
		...input,
		tiers: { ...input.tiers, ...transport }
	});
	const problem = {
		max_entities: MAX_BLUEPRINT_ENTITIES,
		logistics: request.logistics,
		transport: request.transport,
		layout: request.layout,
		inserters: request.inserters,
		nativePlan: request.nativePlan,
		fixedPlan: request.fixedPlan,
		area: [
			[0, 0],
			[request.width, request.height]
		],
		inputs: request.inputs.filter((port) => port.type !== 'fluid'),
		fluid_inputs: request.inputs.filter((port) => port.type === 'fluid'),
		// Keep a short approach clear too: reserving only the endpoint can seal it behind belts.
		obstacles: [
			...request.inputs.map((port) => ({ port, sign: 1 })),
			...request.outputs.map((port) => ({ port, sign: -1 }))
		]
			.filter(({ port }) => port.type === 'fluid')
			.flatMap(({ port, sign }) => {
				const vectors = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] } as const;
				const [x, y] = vectors[port.direction];
				return [0, 1, 2].map((distance) => ({
					x: Math.floor(port.position.x) + x * sign * distance,
					y: Math.floor(port.position.y) + y * sign * distance
				}));
			}),
		outputs: request.outputs.map((port) => ({ ...port, rate: port.perMinute / 60 })),
		tiers: { ...request.tiers, poles: [request.tiers.pole] },
		// Keep candidate search bounded; failure never lowers a player's requested rate.
		max_chains: 3
	};
	const raw = await new Promise<string>((resolve, reject) => {
		const child = spawn('lua', ['-'], {
			env: { PATH: process.env.PATH },
			stdio: ['pipe', 'pipe', 'ignore'],
			signal
		});
		let output = '';
		const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
		child.on('error', reject);
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString();
			if (Buffer.byteLength(output) > 320000) child.kill('SIGKILL');
		});
		child.on('close', (code) => {
			clearTimeout(deadline);
			if (code === 0) resolve(output);
			else
				reject(
					new ServerError(
						400,
						'Factory compiler exceeded its search or memory budget; reduce the block or split the target'
					)
				);
		});
		child.stdin.on('error', () => {});
		child.stdin.end(
			`local modules={${Object.entries(modules)
				.map(([name, body]) => `[ ${luaString(name)} ]=function()\n${body}\nend`)
				.join(
					',\n'
				)}}\nlocal problem=${luaData(problem)}\nlocal pack=${luaData(pack)}\nlocal options=(function()\n${options}\nend)()\nlocal interfaces=(function()\n${interfaces}\nend)()\nlocal compress=(function()\n${compression}\nend)()\nlocal beltPlan=function()\n${belts}\nend\nlocal adapter=function()\nif problem.nativePlan then\n${nativePlan}\nend\nif problem.logistics then\n${logistics}\nend\n${adapter}\nend\n${source}`
		);
	});
	const reply = z
		.discriminatedUnion('ok', [
			z.object({ ok: z.literal(true), result: resultSchema }),
			z.object({ ok: z.literal(false), error: z.string() })
		])
		.parse(JSON.parse(raw));
	if (!reply.ok) throw new ServerError(400, reply.error);
	const { entities, wires, tiles, ...report } = reply.result;
	if (request.fixedPlan) {
		const plan = z
			.object({
				plan: z.object({
					lines: z.array(
						z.object({
							recipe: z.string(),
							machine: z.string(),
							machines: z.number().nonnegative()
						})
					)
				})
			})
			.parse(pack).plan;
		const expected = new Map<string, number>();
		for (const line of plan.lines)
			expected.set(
				line.machine,
				(expected.get(line.machine) ?? 0) + Math.ceil(line.machines - 1e-9)
			);
		for (const [machine, count] of expected) {
			if (entities.filter((entity) => entity.name === machine).length !== count)
				throw new ServerError(
					400,
					`Layout changed the saved count for ${machine}; plan was not modified`
				);
		}
	}
	const endpoints = (kind: 'input' | 'output') =>
		report.ports
			.filter((port) => port.kind === kind)
			.map((port) => {
				if (request.logistics) {
					const source = (kind === 'input' ? request.inputs : request.outputs).find(
						(source) => source.item === port.item
					);
					if (!source || !port.perMinute)
						throw new ServerError(400, 'Compiler returned an unknown logistics endpoint');
					return {
						entity: port.entity,
						kind: source.type ?? ('item' as const),
						temperature: source.type === 'fluid' ? source.temperature : undefined,
						name: port.item,
						perMinute: port.perMinute
					};
				}
				const source = (kind === 'input' ? request.inputs : request.outputs).find(
					(p) =>
						p.item === port.item &&
						p.position.x === port.position.x &&
						p.position.y === port.position.y
				);
				if (!source) throw new ServerError(400, 'Compiler returned an unknown factory port');
				return {
					entity: port.entity,
					kind: source.type ?? ('item' as const),
					temperature: source.type === 'fluid' ? source.temperature : undefined,
					name: port.item,
					perMinute: source.perMinute
				};
			});
	const pole = entities.find((entity) => entity.name === request.tiers.pole);
	if (!pole) throw new ServerError(400, 'Compiler returned no power connection');
	let sampleSeconds = 120;
	if (request.logistics && !request.nativePlan) {
		const recipes = z
			.object({
				recipes: z.record(
					z.string(),
					z.object({ results: z.array(z.object({ amount: z.number().positive() })).min(1) })
				)
			})
			.parse(pack).recipes;
		const step = report.steps[0];
		const output = request.outputs[0];
		const batch = step && recipes[step.recipe]?.results[0];
		if (!step || !output || !batch)
			throw new ServerError(400, 'Compiler returned no logistics production recipe');
		const cycle = (60 * batch.amount * step.machines) / output.perMinute;
		const duration = Math.floor(120 / cycle + 1e-9) * cycle;
		// Observe whole supply cycles, with at least three batches per cell. A
		// partial last cycle can reject a working slow array through sampling alone.
		if (cycle <= 40 && Math.abs(duration - Math.round(duration)) < 1e-6)
			sampleSeconds = Math.round(duration);
	}
	return {
		design: blueprintDesignSchema.parse({
			force: request.force,
			label: request.label,
			entities,
			wires,
			tiles
		}),
		...report,
		test: {
			operation: 'run' as const,
			force: request.force,
			surface: request.surface,
			inputs: endpoints('input'),
			outputs: endpoints('output'),
			// Compiled blocks use the accelerated headless fixture, including buffer startup.
			// Slower batch recipes need a separately qualified longer fixture.
			warmupSeconds:
				request.tiers.pipe &&
				entities.some(
					(entity) =>
						entity.name === request.tiers.pipe || entity.name === request.tiers.pipe_underground
				)
					? 300
					: 120,
			seconds: sampleSeconds,
			power: 'design' as const,
			powerPosition: { x: Math.floor(pole.position.x), y: Math.floor(pole.position.y) }
		}
	};
}
