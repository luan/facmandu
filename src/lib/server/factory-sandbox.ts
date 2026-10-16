import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { blueprintArtifactSchema } from '$lib/blueprints';
import type { ManagedServer } from './db/schema';
import { factoryBlueprint, readBlueprintDraft } from './factory-blueprints';
import { recordCompiledFactoryTrial } from './factory-layout-status';
import { ServerError } from './server-files';
import { rconScript } from './server-rcon';

const force = z.string().min(1).max(100);
const endpoint = z.strictObject({
	entity: z.number().int().min(1).max(1000),
	kind: z.enum(['item', 'fluid']),
	name: z.string().min(1).max(200),
	perMinute: z.number().min(0.01).max(1000000),
	lane: z.union([z.literal(1), z.literal(2)]).optional(),
	temperature: z.number().finite().optional()
});
const position = z.strictObject({
	x: z.number().int().min(-1000000).max(1000000),
	y: z.number().int().min(-1000000).max(1000000)
});
const robotTarget = z.strictObject({
	minimumIdle: z.number().int().min(1).max(64),
	maximumTotal: z.number().int().min(3).max(5000)
});
export const sandboxRequestSchema = z.discriminatedUnion('operation', [
	z.strictObject({
		operation: z.literal('run'),
		force,
		designId: z.string().regex(/^[a-f0-9]{64}$/u),
		surface: force,
		position: position.optional(),
		context: z.boolean().default(false),
		mode: z.enum(['production', 'transport', 'robot-deployment']).default('production'),
		robots: z
			.strictObject({
				port: z.number().int().min(1).max(64),
				logistic: robotTarget,
				construction: robotTarget
			})
			.optional(),
		inputs: z.array(endpoint).max(16).default([]),
		outputs: z.array(endpoint).max(16).default([]),
		seconds: z.number().int().min(10).max(120).default(30),
		warmupSeconds: z.number().int().min(0).max(30).default(10),
		power: z.enum(['provided', 'design']).default('provided'),
		powerPosition: position.optional()
	}),
	z.strictObject({ operation: z.enum(['read', 'cancel']), force, id: z.string().regex(/^\d+$/u) })
]);
export const sandboxToolJsonSchema = z.toJSONSchema(sandboxRequestSchema, { io: 'input' });

export const sandboxResultSchema = z
	.object({
		id: z.string(),
		status: z.enum(['running', 'done', 'cancelled', 'error']),
		tick: z.number().optional(),
		phase: z.string().optional(),
		elapsedTicks: z.number().nonnegative().optional(),
		passed: z.boolean().optional(),
		outputs: z
			.array(
				z
					.object({
						perMinute: z.number().nonnegative(),
						targetPerMinute: z.number().positive(),
						met: z.boolean()
					})
					.passthrough()
			)
			.optional()
	})
	.passthrough()
	.transform((result) => {
		if (
			result.status !== 'done' ||
			!result.outputs?.some((o) => o.perMinute < o.targetPerMinute * 0.95)
		)
			return result;
		// A batch-boundary allowance can explain a short sample, not prove its target.
		return {
			...result,
			passed: false,
			verdict: result.passed ? 'inconclusive' : result.verdict,
			outputs: result.outputs.map((o) => ({
				...o,
				met: o.met && o.perMinute >= o.targetPerMinute * 0.95
			}))
		};
	});
type TrialResult = z.infer<typeof sandboxResultSchema>;
type Actor = { name: string; requireAdmin: boolean };

export function sandboxCommand(method: 'start' | 'read' | 'cancel', args: unknown[]) {
	const encoded = JSON.stringify(args);
	let delimiter = '=';
	while (encoded.includes(`]${delimiter}]`)) delimiter += '=';
	return `/silent-command local ok,result=pcall(function()
if not remote.interfaces['facmandu-toby-sandbox'] then error('Update Toby on server and clients to enable native sandbox trials',0) end
return remote.call('facmandu-toby-sandbox',${JSON.stringify(method)},table.unpack(helpers.json_to_table([${delimiter}[${encoded}]${delimiter}])))
end); rcon.print(helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result):match('^[^\\n]*')}))`;
}

async function call(server: ManagedServer, method: 'start' | 'read' | 'cancel', args: unknown[]) {
	const raw = await rconScript(server, sandboxCommand(method, args));
	const reply = z
		.discriminatedUnion('ok', [
			z.object({ ok: z.literal(true), result: sandboxResultSchema }),
			z.object({ ok: z.literal(false), error: z.string() })
		])
		.parse(JSON.parse(raw.trim()));
	if (!reply.ok) throw new ServerError(409, reply.error);
	return reply.result;
}

export async function testFactoryBlueprint(
	server: ManagedServer,
	input: unknown,
	options: {
		actor?: Actor;
		signal?: AbortSignal;
		requestId: string;
		progress: (result: TrialResult) => void;
	}
) {
	const data = sandboxRequestSchema.parse(input);
	if (data.operation !== 'run') {
		const result = await call(server, data.operation, [data.force, data.id]);
		await recordCompiledFactoryTrial(server.directory, data.force, result);
		return result;
	}
	const draft = await readBlueprintDraft(server.directory, data.designId, data.force);
	const artifact = blueprintArtifactSchema.parse(
		await factoryBlueprint(server, { ...draft, operation: 'create' }, options.actor)
	);
	const idempotencyKey = createHash('sha256')
		.update(JSON.stringify([options.requestId, data]))
		.digest('hex');
	let result = await call(server, 'start', [
		{
			...data,
			blueprint: artifact.blueprint,
			anchor: draft.entities[0]?.position,
			actor: options.actor,
			idempotencyKey
		}
	]);
	options.progress(result);
	// Native ticks finish and clean up the lab even if the web process restarts.
	// A paused server returns a resumable receipt instead of changing global pause.
	let unchanged = 0;
	let lastProgress = 0;
	try {
		for (let elapsed = 0; result.status === 'running' && elapsed < 180; elapsed += 2) {
			await delay(2000, undefined, { signal: options.signal });
			const next = await call(server, 'read', [data.force, result.id]);
			unchanged = next.tick === result.tick ? unchanged + 2 : 0;
			result = next;
			if (elapsed - lastProgress >= 10 || result.status !== 'running') {
				options.progress(result);
				lastProgress = elapsed;
			}
			if (unchanged >= 6)
				return {
					...result,
					waitingForGameTicks: true,
					note: 'Game ticks are paused. Read this trial after play resumes; global pause was not changed.'
				};
		}
		await recordCompiledFactoryTrial(server.directory, data.force, result);
		return result;
	} catch (cause) {
		if (options.signal?.aborted)
			await call(server, 'cancel', [data.force, result.id]).catch(() => {});
		throw cause;
	}
}
