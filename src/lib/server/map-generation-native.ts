import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	writeFile
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { WorldGenerationSettings } from '$lib/map-generation';
import {
	fromFactorioMapSettings,
	toFactorioMapSettings,
	worldGenerationSchema
} from '$lib/map-generation';
import type { ManagedServer } from './db/schema';
import { ServerError, serverConfig } from './server-files';
import { executable } from './server-process';

const run = promisify(execFile);
const catalogsInProgress = new Map<string, Promise<MapGenerationCatalog>>();
const previewsInProgress = new Map<string, Promise<Buffer>>();
const previewByServer = new Map<string, string>();
const MAX_DUMP_BYTES = 320 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEWS = 32;

type NativeControl = {
	name?: string;
	category?: string;
	richness?: boolean;
	can_be_disabled?: boolean;
	order?: string;
	hidden?: boolean;
};
type NativePreset = {
	order?: string;
	default?: boolean;
	basic_settings?: Record<string, unknown>;
	advanced_settings?: Record<string, unknown>;
};
type NativeDump = {
	'autoplace-control'?: Record<string, NativeControl>;
	'map-gen-presets'?: Record<string, { name?: string } & Record<string, NativePreset | string>>;
	planet?: Record<string, { map_gen_settings?: Record<string, unknown> }>;
};
export type MapGenerationCatalog = {
	presets: {
		name: string;
		label: string;
		order?: string;
		defaults?: WorldGenerationSettings;
		basicSettings?: Record<string, unknown>;
		advancedSettings?: Record<string, unknown>;
	}[];
	resources: {
		name: string;
		label: string;
		description?: string;
		order?: string;
		category: string;
		richness: boolean;
		canBeDisabled: boolean;
	}[];
	controls: {
		name: string;
		label: string;
		description?: string;
		order?: string;
		category: string;
		richness: boolean;
		canBeDisabled: boolean;
	}[];
	nativeMapGenDefaults: Record<string, unknown>;
	supportsNoEnemies: boolean;
	previewAvailable: boolean;
	previewReason?: string;
};

async function packageFiles(
	directory: string,
	prefix = '',
	seen = new Set<string>(),
	depth = 0
): Promise<(string | number)[][]> {
	if (depth > 20) throw new ServerError(409, 'Mod directory nesting is too deep');
	const source = await realpath(directory);
	if (seen.has(source)) return [];
	seen.add(source);
	const files: (string | number)[][] = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name)
	)) {
		const path = join(directory, entry.name);
		const relative = join(prefix, entry.name);
		const info = await stat(path);
		files.push([relative, info.size, info.mtimeMs]);
		if (info.isDirectory()) files.push(...(await packageFiles(path, relative, seen, depth + 1)));
	}
	return files;
}

async function fingerprint(server: ManagedServer) {
	const config = await serverConfig(server);
	if (!config.version) throw new ServerError(409, 'Select a Factorio version first');
	const binary = await stat(await executable(server));
	const mods = join(server.directory, 'mods');
	const files = await packageFiles(mods);
	const modList = await readFile(join(mods, 'mod-list.json'));
	const modSettings = await readFile(join(mods, 'mod-settings.dat')).catch(
		(cause: NodeJS.ErrnoException) => {
			if (cause.code === 'ENOENT') return Buffer.alloc(0);
			throw cause;
		}
	);
	return createHash('sha256')
		.update(JSON.stringify([config.version, binary.size, binary.mtimeMs, files]))
		.update(modList)
		.update(modSettings)
		.digest('hex');
}

async function snapshotMods(source: string, destination: string) {
	await mkdir(destination);
	for (const entry of await readdir(source, { withFileTypes: true })) {
		const from = join(source, entry.name);
		const to = join(destination, entry.name);
		const info = await stat(from);
		if (info.isDirectory() || entry.name.endsWith('.zip'))
			await symlink(await realpath(from), to, info.isDirectory() ? 'dir' : 'file');
		else if (info.isFile()) await copyFile(from, to);
	}
}

async function withProfile<T>(
	server: ManagedServer,
	callback: (profile: { binary: string; args: string[]; directory: string }) => Promise<T>
) {
	const directory = join(server.directory, 'map-generation-cache', `.run-${randomUUID()}`);
	const write = join(directory, 'write');
	await mkdir(write, { recursive: true });
	try {
		const binary = await executable(server);
		const mods = join(directory, 'mods');
		await snapshotMods(join(server.directory, 'mods'), mods);
		const config = join(directory, 'config.ini');
		await writeFile(
			config,
			`[path]\nread-data=${join(dirname(binary), '..', '..', 'data')}\nwrite-data=${write}\n`,
			{ mode: 0o600 }
		);
		return await callback({
			binary,
			args: ['--config', config, '--mod-directory', mods],
			directory
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const label = (name: string) =>
	name.replaceAll(/[-_]/gu, ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
const localized = (value: string | undefined, fallback: string) =>
	value?.replace(/\[[^\]]+\]/gu, '').trim() || label(fallback);

function mergeObjects(
	base: Record<string, unknown>,
	override: Record<string, unknown>
): Record<string, unknown> {
	const result = { ...base };
	for (const [name, value] of Object.entries(override)) {
		const previous = result[name];
		result[name] =
			value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			previous &&
			typeof previous === 'object' &&
			!Array.isArray(previous)
				? mergeObjects(previous as Record<string, unknown>, value as Record<string, unknown>)
				: value;
	}
	return result;
}

function withoutComments(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutComments);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([name]) => !name.startsWith('_comment'))
			.map(([name, item]) => [name, withoutComments(item)])
	);
}

async function nativeCatalog(server: ManagedServer, key: string): Promise<MapGenerationCatalog> {
	const cache = join(server.directory, 'map-generation-cache');
	const ready = join(cache, `${key}.v6.json`);
	try {
		return JSON.parse(await readFile(ready, 'utf8')) as MapGenerationCatalog;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
	}
	const catalog = await withProfile(server, async ({ binary, args, directory }) => {
		const output = join(directory, 'write', 'script-output');
		try {
			await run('xvfb-run', ['-a', binary, ...args, '--threads', '2', '--dump-data'], {
				timeout: 180_000,
				maxBuffer: 4 * 1024 * 1024
			});
			const dumpFile = join(output, 'data-raw-dump.json');
			if ((await stat(dumpFile)).size > MAX_DUMP_BYTES)
				throw new ServerError(503, 'Factorio map data is too large');
			const dump = JSON.parse(await readFile(dumpFile, 'utf8')) as NativeDump;
			const controls = dump['autoplace-control'];
			const presets = dump['map-gen-presets']?.default;
			if (!controls || !presets)
				throw new ServerError(503, 'Factorio map controls are unavailable');
			// Locale is a separate native export. It shares the isolated profile and mods.
			await run('xvfb-run', ['-a', binary, ...args, '--threads', '2', '--dump-prototype-locale'], {
				timeout: 180_000,
				maxBuffer: 4 * 1024 * 1024
			});
			const locale = JSON.parse(
				await readFile(join(output, 'autoplace-control-locale.json'), 'utf8').catch(() => '{}')
			) as { names?: Record<string, string>; descriptions?: Record<string, string> };
			const data = join(dirname(binary), '..', '..', 'data');
			const baseMapGen = withoutComments(
				JSON.parse(await readFile(join(data, 'map-gen-settings.example.json'), 'utf8'))
			) as Record<string, unknown>;
			const baseMapSettings = withoutComments(
				JSON.parse(await readFile(join(data, 'map-settings.example.json'), 'utf8'))
			) as Record<string, unknown>;
			const planetSettings = dump.planet?.nauvis?.map_gen_settings ?? {};
			const nativeMapGenDefaults = mergeObjects(baseMapGen, planetSettings);
			const nauvis = planetSettings.autoplace_controls as Record<string, unknown> | undefined;
			const allControls = Object.entries(controls)
				.filter(([name, value]) => !value.hidden && (!nauvis || name in nauvis))
				.map(([name, value]) => ({
					name,
					label: localized(locale.names?.[name], name),
					description: locale.descriptions?.[name],
					order: value.order,
					category: value.category ?? 'resource',
					richness: value.richness ?? false,
					canBeDisabled: value.can_be_disabled ?? true
				}))
				.sort(
					(a, b) => (a.order ?? '').localeCompare(b.order ?? '') || a.label.localeCompare(b.label)
				);
			const resources = allControls.filter(
				(value) => value.category === 'resource' || value.category === 'enemy'
			);
			const presetList = Object.entries(presets)
				.filter(([name, value]) => name !== 'name' && !!value && typeof value === 'object')
				.map(([name, value]) => {
					const preset = value as NativePreset;
					const defaults = fromFactorioMapSettings(
						mergeObjects(nativeMapGenDefaults, preset.basic_settings ?? {}),
						mergeObjects(baseMapSettings, preset.advanced_settings ?? {})
					);
					const resourceDefaults = { ...defaults.resources };
					for (const control of resources) {
						const native = resourceDefaults[control.name] ?? {};
						resourceDefaults[control.name] = {
							frequency: native.frequency ?? 1,
							size: native.size ?? 1,
							...(control.richness && { richness: native.richness ?? 1 })
						};
					}
					defaults.resources = resourceDefaults;
					return {
						name,
						label: label(name),
						order: preset.order,
						defaults,
						...(preset.basic_settings && { basicSettings: preset.basic_settings }),
						...(preset.advanced_settings && { advancedSettings: preset.advanced_settings })
					};
				})
				.sort(
					(a, b) => (a.order ?? '').localeCompare(b.order ?? '') || a.label.localeCompare(b.label)
				);
			const help = await run(binary, ['--help'], { timeout: 10_000, maxBuffer: 512 * 1024 });
			const previewAvailable = help.stdout.includes('--generate-map-preview');
			const version = (await serverConfig(server)).version?.version ?? '0.0.0';
			const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
			return {
				presets: presetList,
				resources,
				controls: allControls,
				nativeMapGenDefaults,
				supportsNoEnemies: major > 2 || (major === 2 && (minor > 0 || patch >= 7)),
				previewAvailable,
				...(!previewAvailable && {
					previewReason: 'This Factorio installation cannot generate map previews'
				})
			};
		} catch (cause) {
			if (cause instanceof ServerError) throw cause;
			throw new ServerError(503, 'Factorio map catalog export failed');
		}
	});
	if ((await fingerprint(server)) !== key)
		throw new ServerError(409, 'Server mods changed during map catalog export');
	await mkdir(cache, { recursive: true });
	const temporary = `${ready}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify(catalog), { mode: 0o600 });
		await rename(temporary, ready);
	} finally {
		await rm(temporary, { force: true });
	}
	const catalogs = await Promise.all(
		(await readdir(cache))
			.filter((name) => name.endsWith('.json'))
			.map(async (name) => ({ name, mtime: (await stat(join(cache, name))).mtimeMs }))
	);
	for (const stale of catalogs.sort((a, b) => b.mtime - a.mtime).slice(8))
		await rm(join(cache, stale.name), { force: true });
	return catalog;
}

export async function mapGenerationCatalog(server: ManagedServer) {
	const key = await fingerprint(server);
	let pending = catalogsInProgress.get(key);
	if (!pending) {
		pending = nativeCatalog(server, key);
		catalogsInProgress.set(key, pending);
		void pending.finally(() => catalogsInProgress.delete(key)).catch(() => {});
	}
	return pending;
}

export async function withNativeMapGeneration<T>(
	server: ManagedServer,
	settings: WorldGenerationSettings,
	callback: (context: { binary: string; args: string[]; directory: string }) => Promise<T>
): Promise<T> {
	const before = await fingerprint(server);
	if (settings.noEnemiesMode) {
		const version = (await serverConfig(server)).version?.version ?? '0.0.0';
		const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
		if (major < 2 || (major === 2 && minor === 0 && patch < 7))
			throw new ServerError(400, 'This Factorio version does not support no-enemies mode');
	}
	const { preset, mapGenSettings, mapSettings } = toFactorioMapSettings(settings);
	const catalog =
		preset !== 'default' || Object.keys(settings.resources ?? {}).length
			? await mapGenerationCatalog(server)
			: null;
	const selected = catalog?.presets.find((item) => item.name === preset);
	if (catalog) {
		if (!selected) throw new ServerError(400, 'Unknown map preset');
		for (const name of Object.keys(settings.resources ?? {}))
			if (!catalog.controls.some((item) => item.name === name))
				throw new ServerError(400, `Unknown resource control: ${name}`);
	}
	return withProfile(server, async ({ binary, args, directory }) => {
		if ((await fingerprint(server)) !== before)
			throw new ServerError(409, 'Server mods changed during map generation');
		const genFile = join(directory, 'map-gen-settings.json');
		const settingsFile = join(directory, 'map-settings.json');
		const nativeArgs = [...args];
		// Factorio applies --preset after --map-gen-settings for some fields (notably
		// elevation), so resolve the preset before handing settings to the binary.
		const effectiveMapGen =
			selected && catalog
				? mergeObjects(
						mergeObjects(catalog.nativeMapGenDefaults, selected.basicSettings ?? {}),
						mapGenSettings
					)
				: mapGenSettings;
		if (settings.terrain?.mapType === 'normal') {
			const expressions = {
				...(effectiveMapGen.property_expression_names as Record<string, unknown> | undefined)
			};
			delete expressions.elevation;
			effectiveMapGen.property_expression_names = expressions;
		}
		if (Object.keys(effectiveMapGen).length) {
			await writeFile(genFile, JSON.stringify(effectiveMapGen), { mode: 0o600 });
			nativeArgs.push('--map-gen-settings', genFile);
		}
		if (Object.keys(mapSettings).length || selected?.advancedSettings) {
			const exampleFile = join(dirname(binary), '..', '..', 'data', 'map-settings.example.json');
			const example = JSON.parse(await readFile(exampleFile, 'utf8')) as Record<string, unknown>;
			const presetDefaults = selected?.advancedSettings ?? {};
			const effective = mergeObjects(
				mergeObjects(withoutComments(example) as Record<string, unknown>, presetDefaults),
				mapSettings
			);
			if (settings.expansion) {
				const native = (effective.enemy_expansion ?? {}) as Record<string, unknown>;
				const expansion = {
					minCooldown: native.min_expansion_cooldown,
					maxCooldown: native.max_expansion_cooldown,
					minGroupSize: native.settler_group_min_size,
					maxGroupSize: native.settler_group_max_size
				};
				const parsed = worldGenerationSchema.shape.expansion.safeParse(expansion);
				if (!parsed.success)
					throw new ServerError(
						400,
						parsed.error.issues[0]?.message ?? 'Invalid enemy expansion settings'
					);
			}
			await writeFile(settingsFile, JSON.stringify(effective), { mode: 0o600 });
			nativeArgs.push('--map-settings', settingsFile);
		}
		const result = await callback({ binary, directory, args: nativeArgs });
		if ((await fingerprint(server)) !== before)
			throw new ServerError(409, 'Server mods changed during map generation');
		return result;
	});
}

export async function mapGenerationPreview(
	server: ManagedServer,
	settings: WorldGenerationSettings
): Promise<Buffer> {
	if (settings.seed === undefined)
		throw new ServerError(400, 'Choose a map seed before previewing');
	const catalog = await mapGenerationCatalog(server);
	if (!catalog.previewAvailable)
		throw new ServerError(503, catalog.previewReason ?? 'Map preview is unavailable');
	if (settings.noEnemiesMode && !catalog.supportsNoEnemies)
		throw new ServerError(400, 'This Factorio version does not support no-enemies mode');
	const initialFingerprint = await fingerprint(server);
	const key = createHash('sha256')
		.update('resolved-map-settings-v1')
		.update(initialFingerprint)
		.update(JSON.stringify(settings))
		.digest('hex');
	const cache = join(server.directory, 'map-generation-cache', 'previews');
	const ready = join(cache, `${key}.png`);
	try {
		return await readFile(ready);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
	}
	let pending = previewsInProgress.get(key);
	if (!pending) {
		if (previewByServer.has(server.id))
			throw new ServerError(409, 'A map preview is already running');
		previewByServer.set(server.id, key);
		pending = withNativeMapGeneration(server, settings, async ({ binary, args, directory }) => {
			const image = join(directory, 'preview.png');
			try {
				await run(
					'xvfb-run',
					[
						'-a',
						binary,
						...args,
						'--generate-map-preview',
						image,
						'--map-preview-size',
						'512',
						'--threads',
						'2'
					],
					{ timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
				);
				const info = await stat(image);
				if (info.size > MAX_PREVIEW_BYTES)
					throw new ServerError(503, 'Factorio map preview is too large');
				const png = await readFile(image);
				if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
					throw new ServerError(503, 'Factorio did not produce a PNG preview');
				if ((await fingerprint(server)) !== initialFingerprint)
					throw new ServerError(409, 'Server mods changed during preview');
				await mkdir(cache, { recursive: true });
				await writeFile(ready, png, { mode: 0o600 });
				const entries = await Promise.all(
					(await readdir(cache))
						.filter((name) => name.endsWith('.png'))
						.map(async (name) => ({ name, mtime: (await stat(join(cache, name))).mtimeMs }))
				);
				for (const stale of entries.sort((a, b) => b.mtime - a.mtime).slice(MAX_PREVIEWS))
					await rm(join(cache, stale.name), { force: true });
				return png;
			} catch (cause) {
				if (cause instanceof ServerError) throw cause;
				throw new ServerError(503, 'Factorio map preview failed');
			}
		});
		previewsInProgress.set(key, pending);
		void pending
			.finally(() => {
				previewsInProgress.delete(key);
				previewByServer.delete(server.id);
			})
			.catch(() => {});
	}
	return pending;
}
