import { spawn } from 'node:child_process';
import { z } from 'zod';
import { blueprintDesignSchema } from '$lib/blueprints';
import { type FactoryLayoutInput, factoryLayoutInput } from '$lib/factory-layout';
import adapter from './factory-layout-adapter.lua?raw';
import logistics from './factory-layout-logistics.lua?raw';
import source from './factory-layout-worker.lua?raw';
import { luaString } from './factory-query-bundle';
import { ServerError } from './server-files';

const resultSchema = z.object({
	entities: blueprintDesignSchema.shape.entities,
	wires: blueprintDesignSchema.shape.wires,
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
	input: FactoryLayoutInput,
	pack: z.infer<ReturnType<typeof z.json>>,
	modules: Record<string, string>,
	signal?: AbortSignal
) {
	const request = factoryLayoutInput.parse(input);
	const problem = {
		logistics: request.logistics,
		area: [
			[0, 0],
			[request.width, request.height]
		],
		inputs: request.inputs.filter((port) => port.type !== 'fluid'),
		fluid_inputs: request.inputs.filter((port) => port.type === 'fluid'),
		// Item routing must leave the fluid entry tiles available for pipes.
		obstacles: request.inputs
			.filter((port) => port.type === 'fluid')
			.map((port) => ({ x: Math.floor(port.position.x), y: Math.floor(port.position.y) })),
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
			if (Buffer.byteLength(output) > 192000) child.kill('SIGKILL');
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
				)}}\nlocal problem=${luaData(problem)}\nlocal pack=${luaData(pack)}\nlocal adapter=function()\nif problem.logistics then\n${logistics}\nend\n${adapter}\nend\n${source}`
		);
	});
	const reply = z
		.discriminatedUnion('ok', [
			z.object({ ok: z.literal(true), result: resultSchema }),
			z.object({ ok: z.literal(false), error: z.string() })
		])
		.parse(JSON.parse(raw));
	if (!reply.ok) throw new ServerError(400, reply.error);
	const { entities, wires, ...report } = reply.result;
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
					name: port.item,
					perMinute: source.perMinute
				};
			});
	const pole = entities.find((entity) => entity.name === request.tiers.pole);
	if (!pole) throw new ServerError(400, 'Compiler returned no power connection');
	return {
		design: blueprintDesignSchema.parse({
			force: request.force,
			label: request.label,
			entities,
			wires
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
			warmupSeconds: 120,
			seconds: 120,
			power: 'design' as const,
			powerPosition: { x: Math.floor(pole.position.x), y: Math.floor(pole.position.y) }
		}
	};
}
