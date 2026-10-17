import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { inflateSync } from 'node:zlib';
import { z } from 'zod';
import type { BlueprintArtifact } from '$lib/blueprints';
import type { FactoryLayoutInput } from '$lib/factory-layout';
import events from '../../../factorio-mod/facmandu-assistant/events.lua?raw';
import robotTrial from '../../../factorio-mod/facmandu-assistant/robot-trial.lua?raw';
import sandbox from '../../../factorio-mod/facmandu-assistant/sandbox.lua?raw';
import type { ManagedServer } from './db/schema';
import type { compileFactoryLayout } from './factory-layout-compiler';
import packSource from './factory-layout-pack.lua?raw';
import { recordCompiledFactoryTrial } from './factory-layout-status';
import control from './factory-native-trial.lua?raw';
import { luaString } from './factory-query-bundle';
import { aggregateLogisticsOutputs, sandboxResultSchema } from './factory-sandbox';
import { nativeProfileFingerprint, withNativeProfile } from './map-generation-native';
import { ServerError } from './server-files';
import { run } from './server-process';

export const factoryTrialContextSchema = z.preprocess(
	(value) => {
		if (typeof value !== 'string') return value;
		return JSON.parse(
			inflateSync(Buffer.from(value, 'base64'), { maxOutputLength: 8 * 1024 * 1024 }).toString(
				'utf8'
			)
		) as unknown;
	},
	z.object({
		technologies: z.record(
			z.string(),
			z.object({ researched: z.boolean(), level: z.number().int().nonnegative() })
		),
		recipes: z.object({
			defaultEnabled: z.boolean(),
			exceptions: z.record(z.string(), z.literal(true)),
			count: z.number().int().nonnegative()
		}),
		properties: z.record(z.string(), z.number().finite()),
		runtimeSettings: z.record(z.string(), z.json()),
		modifiers: z.partialRecord(
			z.enum([
				'inserter_stack_size_bonus',
				'bulk_inserter_capacity_bonus',
				'stack_inserter_capacity_bonus'
			]),
			z.number().finite()
		),
		mods: z.record(z.string(), z.string()),
		daytime: z.number(),
		freezeDaytime: z.boolean(),
		solarPowerMultiplier: z.number()
	})
);
type TrialResult = z.infer<typeof sandboxResultSchema>;
type CompiledTest = Awaited<ReturnType<typeof compileFactoryLayout>>['test'];
let queue: Promise<void> = Promise.resolve();

export function testCompiledFactory(
	server: ManagedServer,
	input: {
		request: FactoryLayoutInput;
		pack: z.infer<ReturnType<typeof z.json>>;
		context: z.infer<typeof factoryTrialContextSchema>;
		test: CompiledTest;
		artifact: BlueprintArtifact;
	},
	options: { signal?: AbortSignal; progress: (value: TrialResult) => void }
) {
	const designId = input.artifact.designId;
	if (!designId) throw new ServerError(400, 'Native validation requires a saved factory design');
	const id = `headless-${randomUUID()}`;
	const receipt = {
		id,
		designId,
		status: 'running' as const,
		backend: 'headless',
		liveFactoryVerified: false
	};
	options.progress({ ...receipt, note: 'Waiting for the isolated native simulator.' });
	const pending = queue
		.then(async () => {
			options.signal?.throwIfAborted();
			if (freemem() < 4 * 1024 ** 3)
				throw new ServerError(503, 'Not enough free memory for an isolated Factorio trial');
			const fingerprint = await nativeProfileFingerprint(server);
			// Driver storage is empty in this initial save. Bump v1 if the validator
			// adds prototypes or persistent on_init state; runtime source loads fresh.
			const key = createHash('sha256')
				.update('factory-layout-baseline-v1')
				.update(fingerprint)
				.digest('hex');
			const cache = join(server.directory, 'factory-trial-cache');
			await mkdir(cache, { recursive: true, mode: 0o700 });
			const ready = join(cache, `${key}.zip`);
			const result = await withNativeProfile(server, async ({ binary, args, directory }) => {
				const mods = join(directory, 'mods');
				const driver = join(mods, 'facmandu-layout-validator');
				await mkdir(driver);
				const list = z
					.object({
						mods: z.array(z.object({ name: z.string(), enabled: z.boolean() }).passthrough())
					})
					.passthrough()
					.parse(JSON.parse(await readFile(join(mods, 'mod-list.json'), 'utf8')));
				if (list.mods.some((mod) => mod.name === 'facmandu-layout-validator'))
					throw new ServerError(409, 'Native validation mod name is already in use');
				list.mods.push({ name: 'facmandu-layout-validator', enabled: true });
				await writeFile(join(mods, 'mod-list.json'), JSON.stringify(list));
				const info = {
					name: 'facmandu-layout-validator',
					version: '0.0.1',
					title: 'Private native layout validation',
					author: 'Luan',
					factorio_version: '2.1',
					dependencies: ['base']
				};
				const payload = {
					request: input.request,
					context: input.context,
					test: input.test,
					blueprint: input.artifact.blueprint,
					designId,
					anchor: input.artifact.entities[0]?.position
				};
				await Promise.all([
					writeFile(join(driver, 'info.json'), JSON.stringify(info)),
					writeFile(join(driver, 'control.lua'), control),
					writeFile(join(driver, 'events.lua'), events),
					writeFile(join(driver, 'robot-trial.lua'), robotTrial),
					writeFile(
						join(driver, 'sandbox.lua'),
						sandbox.replaceAll('facmandu-toby-sandbox', 'facmandu-layout-sandbox')
					),
					writeFile(join(driver, 'pack.lua'), packSource),
					writeFile(join(driver, 'request.lua'), `return ${luaString(JSON.stringify(payload))}`)
				]);
				const output = join(directory, 'write', 'script-output');
				let phase = 'Loading the matching game and mods in an isolated process.';
				const started = Date.now();
				let reporting = true;
				const progress = setInterval(() => {
					if (!reporting || options.signal?.aborted) return;
					void readFile(join(output, 'layout-progress.json'), 'utf8')
						.then((text) => {
							const native = input.request.logistics
								? aggregateLogisticsOutputs(JSON.parse(text))
								: sandboxResultSchema.parse(JSON.parse(text));
							if (!reporting || options.signal?.aborted) return;
							options.progress({
								...native,
								...receipt,
								elapsedSeconds: Math.floor((Date.now() - started) / 1000),
								note:
									native.phase === 'context'
										? 'Preparing the factory simulation.'
										: typeof native.elapsedTicks === 'number' &&
												native.elapsedTicks < input.test.warmupSeconds * 60
											? 'Filling belts and machine buffers in the simulator.'
											: 'Measuring factory output.'
							});
						})
						.catch(() => {
							if (reporting && !options.signal?.aborted)
								options.progress({
									...receipt,
									elapsedSeconds: Math.floor((Date.now() - started) / 1000),
									note: phase
								});
						})
						.catch(() => {});
				}, 10000);
				try {
					options.progress({ ...receipt, note: phase });
					try {
						await access(ready);
					} catch (cause) {
						if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
						phase = 'Preparing the reusable native test world for these mods.';
						const temporary = join(directory, 'fixture.zip');
						await run(binary, [...args, '--threads', '2', '--create', temporary], {
							signal: options.signal,
							timeout: 180000,
							killSignal: 'SIGKILL',
							maxBuffer: 4 * 1024 * 1024
						});
						await rename(temporary, ready);
					}
					phase = 'Loading the test world and matching mods.';
					await run(
						binary,
						[
							...args,
							'--threads',
							'2',
							'--benchmark',
							ready,
							'--benchmark-ticks',
							'14520',
							'--benchmark-runs',
							'1'
						],
						{
							signal: options.signal,
							timeout: 180000,
							killSignal: 'SIGKILL',
							maxBuffer: 4 * 1024 * 1024
						}
					);
					const observed = z
						.object({
							pack: z.json().optional(),
							result: z.json().optional(),
							error: z.string().optional()
						})
						.parse(JSON.parse(await readFile(join(output, 'layout-trial.json'), 'utf8')));
					if (observed.error) throw new ServerError(409, observed.error);
					if (!isDeepStrictEqual(observed.pack, input.pack))
						throw new ServerError(
							409,
							'The isolated game does not match the live recipe and prototype snapshot; this design is not qualified'
						);
					if ((await nativeProfileFingerprint(server)) !== fingerprint)
						throw new ServerError(409, 'Game or mods changed during native qualification');
					const tested = input.request.logistics
						? aggregateLogisticsOutputs(observed.result)
						: sandboxResultSchema.parse(observed.result);
					return sandboxResultSchema.parse({
						...tested,
						id,
						backend: 'headless',
						contextMatched: true,
						wallSeconds: (Date.now() - started) / 1000
					});
				} finally {
					reporting = false;
					clearInterval(progress);
				}
			});
			await recordCompiledFactoryTrial(server.directory, input.request.force, result);
			options.progress(result);
			return result;
		})
		.catch(async (cause: unknown) => {
			if (options.signal?.aborted || cause instanceof ServerError) throw cause;
			const message = cause instanceof Error ? cause.message : String(cause);
			await writeFile(
				join(server.directory, 'factory-trial-cache', `${id}.log`),
				message.slice(-2 * 1024 * 1024),
				{ mode: 0o600 }
			).catch(() => {});
			throw new ServerError(
				503,
				`Isolated native simulation failed; this draft is not qualified. Receipt: ${id}`
			);
		});
	queue = pending.then(
		() => {},
		() => {}
	);
	return pending;
}
