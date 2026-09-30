import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { compareVersions } from '$lib/dependencies';
import { db } from './db';
import type { ManagedServer } from './db/schema';
import { mod, portalCache } from './db/schema';
import { validModName } from './mod-names';
import { resolveModSettingLocale } from './mod-settings-locale';
import {
	parseModSettingsLua,
	parseNativeModSettings,
	type SettingDef,
	settingDefSchema
} from './mod-settings-lua';
import { type ModSettings, modSettingsSchema, ServerError, serverConfig } from './server-files';
import { serverMods } from './server-mods';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

const defsCacheSchema = z.array(settingDefSchema);
const modVersionSchema = z.string().refine((version) => compareVersions(version, version) !== null);
const CACHE_PREFIX = 'mod-settings-defs:v3:';
const cacheKey = (name: string, version: string, gameVersion: string | null) =>
	`${CACHE_PREFIX}${name}:${version}:${gameVersion ?? 'unknown'}`;
export type ModSettingsCatalog = {
	mods: {
		name: string;
		version: string;
		title: string | null;
		thumbnail: string | null;
		defs: SettingDef[];
	}[];
	unavailable: string[];
};
// Decimal byte escapes keep arbitrary JSON and mod names inside one Lua string.
const luaString = (value: string) =>
	`"${[...Buffer.from(value)].map((byte) => `\\${String(byte).padStart(3, '0')}`).join('')}"`;

async function readCachedDefs(key: string): Promise<SettingDef[] | null> {
	const row = await db
		.select({ body: portalCache.body })
		.from(portalCache)
		.where(eq(portalCache.key, key))
		.get();
	if (!row?.body) return null;
	try {
		const parsed = defsCacheSchema.safeParse(JSON.parse(row.body));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

async function writeCachedDefs(key: string, defs: SettingDef[]) {
	const body = JSON.stringify(defs);
	await db
		.insert(portalCache)
		.values({
			key,
			body,
			status: 200,
			fetchedAt: Date.now(),
			retryAfter: 0,
			etag: null,
			lastModified: null
		})
		.onConflictDoUpdate({ target: portalCache.key, set: { body, fetchedAt: Date.now() } });
}

async function writeCachedDefsBatch(
	items: { name: string; version: string; defs: SettingDef[] }[],
	gameVersion: string | null
) {
	const fetchedAt = Date.now();
	// Stay below SQLite's older 999-bind limit while avoiding one remote round trip per mod.
	for (let index = 0; index < items.length; index += 50) {
		await db
			.insert(portalCache)
			.values(
				items.slice(index, index + 50).map(({ name, version, defs }) => ({
					key: cacheKey(name, version, gameVersion),
					body: JSON.stringify(defs),
					status: 200,
					fetchedAt,
					retryAfter: 0,
					etag: null,
					lastModified: null
				}))
			)
			.onConflictDoUpdate({
				target: portalCache.key,
				set: { body: sql`excluded.body`, fetchedAt: sql`excluded.fetched_at` }
			});
	}
}

// Mod zips are named name_version.zip. When mod-list.json has no version, the
// newest local archive wins. Archives over 256MB are skipped: unzipSync
// transiently holds multiples of the archive, and settings live in code-sized
// mods. Raise the cap when a real mod exceeds it.
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

async function defsForMod(
	modsDirectory: string,
	name: string,
	gameVersion: string | null,
	entries?: string[],
	requestedVersion?: string
): Promise<{ version: string; defs: SettingDef[] } | null> {
	if (!entries) {
		try {
			entries = await readdir(modsDirectory);
		} catch {
			return null;
		}
	}
	let best: { file: string; version: string } | null = null;
	for (const entry of entries) {
		if (!entry.endsWith('.zip') || !entry.startsWith(`${name}_`)) continue;
		const version = entry.slice(name.length + 1, -'.zip'.length);
		if (requestedVersion && requestedVersion !== version) continue;
		if (compareVersions(version, version) === null) continue;
		if (!best || (compareVersions(version, best.version) ?? 0) > 0) best = { file: entry, version };
	}
	if (!best && requestedVersion && !entries.includes(name)) return null;
	// Version-gated settings differ per Factorio release, so it joins the key.
	const key = cacheKey(name, best ? best.version : 'unpacked', gameVersion);
	// Unpacked mod files can change without their version changing.
	const cached = best ? await readCachedDefs(key) : null;
	if (cached && best) {
		if (cached.every((def) => def.label)) return { version: best.version, defs: cached };
		const defs = await resolveModSettingLocale(modsDirectory, name, best.version, cached);
		await writeCachedDefs(key, defs);
		return { version: best.version, defs };
	}
	let defs: SettingDef[] = [];
	try {
		if (!best) {
			// Unpacked mods keep settings.lua next to info.json.
			let source: string | null;
			try {
				source = await readFile(join(modsDirectory, name, 'settings.lua'), 'utf8');
			} catch (cause) {
				if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
				await readFile(join(modsDirectory, name, 'info.json'));
				source = null;
			}
			if (source !== null)
				defs = parseModSettingsLua(source, {
					gameVersion: gameVersion ?? undefined,
					modName: name,
					readSibling: (relativePath) => {
						// Sibling requires must not escape the mod directory.
						if (relativePath.split('/').includes('..')) return null;
						try {
							return readFileSync(join(modsDirectory, name, relativePath), 'utf8');
						} catch {
							return null;
						}
					}
				});
		} else {
			const archive = await readFile(join(modsDirectory, best.file));
			if (archive.length > MAX_ARCHIVE_BYTES) return null;
			// Inflate code only: settings are in Lua, while art dominates archive size.
			const files = unzipSync(archive, {
				filter: (file) => file.name.endsWith('.lua') && !file.name.includes('__MACOSX/')
			});
			// A mod may split settings across subdirectories; parse every match.
			const settingsPaths = Object.keys(files)
				.filter(
					(path) =>
						!path.includes('__MACOSX/') &&
						(path.endsWith('/settings.lua') || path === 'settings.lua')
				)
				.sort();
			for (const settingsPath of settingsPaths) {
				// Factorio resolves siblings from the requiring file upward; walk
				// from its directory to the archive root for the same coverage.
				const roots: string[] =
					settingsPath.lastIndexOf('/') < 0
						? ['']
						: (() => {
								const chain: string[] = [];
								let directory = settingsPath.slice(0, settingsPath.lastIndexOf('/'));
								const stop = settingsPath.split('/')[0] ?? '';
								while (true) {
									if (!chain.includes(directory)) chain.push(directory);
									if (!directory || directory === stop) break;
									directory = directory.slice(0, directory.lastIndexOf('/'));
								}
								return chain;
							})();
				const raw = files[settingsPath];
				if (!raw) continue;
				const source = Buffer.from(raw).toString('utf8');
				defs.push(
					...parseModSettingsLua(source, {
						gameVersion: gameVersion ?? undefined,
						modName: name,
						readSibling: (relativePath) => {
							if (relativePath.includes('__MACOSX/') || relativePath.split('/').includes('..'))
								return null;
							for (const root of roots) {
								const candidate = root ? `${root}/${relativePath}` : relativePath;
								if (candidate.includes('__MACOSX/')) continue;
								const data = files[candidate];
								if (data) return Buffer.from(data).toString('utf8');
							}
							return null;
						}
					})
				);
			}
		}
	} catch {
		return null;
	}
	defs = await resolveModSettingLocale(modsDirectory, name, best ? best.version : 'unpacked', defs);
	if (best) await writeCachedDefs(key, defs);
	return { version: best ? best.version : 'unpacked', defs };
}

export async function modSettingDef(
	server: ManagedServer,
	name: string
): Promise<{ version: string; defs: SettingDef[] } | null> {
	if (!validModName(name) || name === 'base') return null;
	let gameVersion: string | null = null;
	try {
		gameVersion = (await serverConfig(server)).version?.version ?? null;
	} catch {
		gameVersion = null;
	}
	if ((await serverStatus(server)).running) {
		const live = await readLivePrototypeDefs(server, name);
		if (!live.selectedVersion) return null;
		if (live.unavailable.has(name)) throw new Error(`Mod settings too large: ${name}`);
		const defs = await resolveModSettingLocale(
			join(server.directory, 'mods'),
			name,
			live.selectedVersion,
			parseNativeModSettings(live.mods.get(name)?.defs ?? [])
		);
		await writeCachedDefs(cacheKey(name, live.selectedVersion, gameVersion), defs);
		return { version: live.selectedVersion, defs };
	}
	return defsForMod(join(server.directory, 'mods'), name, gameVersion);
}

// Keep both RCON queries on the same prototype fields and value conversion.
function prototypeDefinitionLua(name: string, prototype: string): string {
	return `(function()
      local default = ${prototype}.default_value
      if ${prototype}.type == "color-setting" then
        default = { r = default.r or default[1] or 0, g = default.g or default[2] or 0,
          b = default.b or default[3] or 0, a = default.a or default[4] or 1 }
      end
      local allowed
      if ${prototype}.allowed_values then
        allowed = {}
        for i, value in ipairs(${prototype}.allowed_values) do allowed[i] = value end
      end
      return {
        name = ${name}, type = ${prototype}.type, setting_type = ${prototype}.setting_type,
        default_value = default, minimum_value = ${prototype}.minimum_value,
        maximum_value = ${prototype}.maximum_value, allowed_values = allowed,
        localised_name = ${prototype}.localised_name,
        localised_description = ${prototype}.localised_description,
        order = ${prototype}.order
      }
    end)()`;
}

type LivePrototypePage = {
	items: { owner: string; version: string; def?: unknown; unavailable?: boolean }[];
	next?: number;
	selectedVersion?: string;
	error?: string;
};

async function readLivePrototypeDefs(server: ManagedServer, selected?: string) {
	const mods = new Map<string, { version: string; defs: unknown[] }>();
	const unavailable = new Set<string>();
	let selectedVersion: string | undefined;
	let cursor = 1;
	for (let page = 0; page < 1000; page++) {
		const raw = await rconScript(
			server,
			`/silent-command local selected = ${selected ? luaString(selected) : 'nil'}
local cursor = ${cursor}
local ok, result = pcall(function()
  local names = {}
  for name, prototype in pairs(prototypes.mod_setting) do
    if (not selected or prototype.mod == selected) and script.active_mods[prototype.mod] then
      names[#names + 1] = name
    end
  end
  table.sort(names)
  local items, size = {}, 0
  local index = cursor
  while index <= #names do
    local name = names[index]
    local prototype = prototypes.mod_setting[name]
    local owner = prototype.mod
    local item = {
      owner = owner, version = script.active_mods[owner],
      def = ${prototypeDefinitionLua('name', 'prototype')}
    }
    local encoded = helpers.table_to_json(item)
    if #encoded > 32768 then
      item.def.localised_name = nil
      item.def.localised_description = nil
      encoded = helpers.table_to_json(item)
    end
    if #encoded > 32768 then
      item = { owner = owner, version = script.active_mods[owner], unavailable = true }
      encoded = helpers.table_to_json(item)
    end
    if size + #encoded > 61440 and #items > 0 then break end
    items[#items + 1] = item
    size = size + #encoded
    index = index + 1
  end
  return {
    items = items,
    next = index <= #names and index or nil,
    selectedVersion = selected and script.active_mods[selected] or nil
  }
end)
rcon.print(helpers.table_to_json(ok and result or { error = tostring(result) }))`.replaceAll(
				/\s+/gu,
				' '
			)
		);
		const response: LivePrototypePage = z
			.object({
				items: z.preprocess(
					(value) =>
						value &&
						typeof value === 'object' &&
						!Array.isArray(value) &&
						Object.keys(value).length === 0
							? []
							: value,
					z
						.array(
							z.object({
								owner: z.string(),
								version: modVersionSchema,
								def: z.unknown().optional(),
								unavailable: z.boolean().optional()
							})
						)
						.optional()
				),
				next: z.number().int().positive().optional(),
				selectedVersion: modVersionSchema.optional(),
				error: z.string().optional()
			})
			.transform((value) => ({ ...value, items: value.items ?? [] }))
			.parse(JSON.parse(raw.trim()));
		if (response.error) throw new Error(response.error);
		selectedVersion = response.selectedVersion ?? selectedVersion;
		for (const item of response.items) {
			if (!validModName(item.owner)) continue;
			if (item.unavailable || item.def === undefined) {
				unavailable.add(item.owner);
				continue;
			}
			const entry = mods.get(item.owner) ?? { version: item.version, defs: [] };
			if (entry.version !== item.version)
				throw new Error('Mod version changed during catalog read');
			entry.defs.push(item.def);
			mods.set(item.owner, entry);
		}
		if (response.next === undefined) return { mods, unavailable, selectedVersion };
		if (response.next <= cursor || response.items.length === 0)
			throw new Error('Invalid live mod settings cursor');
		cursor = response.next;
	}
	throw new Error('Live mod settings exceeded page limit');
}

async function catalogMetadata(server: ManagedServer, names: string[]) {
	const metadata = new Map<string, { title: string | null; thumbnail: string | null }>();
	if (!names.length) return metadata;
	if (server.selectedModlist) {
		const rows = await db
			.select({ name: mod.name, title: mod.title, thumbnail: mod.thumbnail })
			.from(mod)
			.where(and(eq(mod.modlist, server.selectedModlist), inArray(mod.name, names)))
			.all();
		for (const row of rows) metadata.set(row.name, { title: row.title, thumbnail: row.thumbnail });
	}
	const rows = await db
		.select({ key: portalCache.key, body: portalCache.body })
		.from(portalCache)
		.where(
			inArray(
				portalCache.key,
				names.map((name) => `mod:${name}`)
			)
		)
		.all();
	const schema = z.object({ title: z.string().nullish(), thumbnail: z.string().nullish() });
	for (const row of rows) {
		if (!row.key.startsWith('mod:') || !row.body) continue;
		try {
			const parsed = schema.safeParse(JSON.parse(row.body));
			if (parsed.success)
				metadata.set(row.key.slice(4), {
					title: parsed.data.title ?? metadata.get(row.key.slice(4))?.title ?? null,
					thumbnail: parsed.data.thumbnail ?? metadata.get(row.key.slice(4))?.thumbnail ?? null
				});
		} catch {
			// A damaged metadata row does not hide valid game settings.
		}
	}
	return metadata;
}

export async function modSettingsCatalog(server: ManagedServer): Promise<ModSettingsCatalog> {
	let gameVersion: string | null = null;
	try {
		gameVersion = (await serverConfig(server)).version?.version ?? null;
	} catch {
		gameVersion = null;
	}
	const defsByMod: { name: string; version: string; defs: SettingDef[] }[] = [];
	const unavailable: string[] = [];
	if ((await serverStatus(server)).running) {
		const live = await readLivePrototypeDefs(server);
		for (const [name, entry] of live.mods) {
			if (!validModName(name) || name === 'base') continue;
			if (live.unavailable.has(name)) continue;
			try {
				const defs = await resolveModSettingLocale(
					join(server.directory, 'mods'),
					name,
					entry.version,
					parseNativeModSettings(entry.defs)
				);
				if (defs.length) defsByMod.push({ name, version: entry.version, defs });
			} catch {
				live.unavailable.add(name);
			}
		}
		unavailable.push(...[...live.unavailable].filter((name) => name !== 'base'));
		try {
			await writeCachedDefsBatch(defsByMod, gameVersion);
		} catch {
			// Cache persistence must not hide definitions read successfully from the game.
		}
	} else {
		const directory = join(server.directory, 'mods');
		const [list, entries] = await Promise.all([serverMods(server), readdir(directory)]);
		for (const item of list.mods) {
			if (!item.enabled || item.name === 'base' || !validModName(item.name)) continue;
			const parsed = await defsForMod(directory, item.name, gameVersion, entries, item.version);
			if (!parsed) unavailable.push(item.name);
			else if (parsed.defs.length) defsByMod.push({ name: item.name, ...parsed });
		}
	}
	const metadata = await catalogMetadata(
		server,
		defsByMod.map(({ name }) => name)
	);
	return {
		mods: defsByMod
			.map(({ name, version, defs }) => ({
				name,
				version,
				defs,
				title: metadata.get(name)?.title?.trim() || name.replaceAll(/[-_]/gu, ' '),
				thumbnail: metadata.get(name)?.thumbnail ?? null
			}))
			.sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name)),
		unavailable: unavailable.sort()
	};
}

// Read the running game's effective values without changing mod-settings.dat.
// The saved file can differ after a save is loaded or a runtime setting changes.
export async function liveModSettings(server: ManagedServer): Promise<ModSettings> {
	const raw = await rconScript(
		server,
		`/silent-command local ok, result = pcall(function()
  local out = { startup = {}, ["runtime-global"] = {}, ["runtime-per-user"] = {} }
  local function copy(source, target)
    for name, setting in pairs(source) do
      local value = setting.value
      if type(value) == "table" then
        value = { r = value.r or value[1] or 0, g = value.g or value[2] or 0,
          b = value.b or value[3] or 0, a = value.a or value[4] or 1 }
      end
      target[name] = { value = value }
    end
  end
  copy(settings.startup, out.startup)
  copy(settings.global, out["runtime-global"])
  copy(settings.player_default, out["runtime-per-user"])
  return out
end)
rcon.print(helpers.table_to_json(ok and { values = result } or { error = tostring(result) }))`.replaceAll(
			/\s+/gu,
			' '
		)
	);
	const response = z
		.object({ values: z.unknown().optional(), error: z.string().optional() })
		.parse(JSON.parse(raw.trim()));
	if (response.error) throw new Error(response.error);
	const values = z
		.object({
			startup: z.unknown(),
			'runtime-global': z.unknown(),
			'runtime-per-user': z.unknown()
		})
		.parse(response.values);
	// Empty Lua tables have no array/object distinction in Factorio's JSON output.
	for (const section of ['startup', 'runtime-global', 'runtime-per-user'] as const) {
		if (Array.isArray(values[section]) && values[section].length === 0) values[section] = {};
	}
	return modSettingsSchema.parse(values);
}

// Runtime-global changes affect the loaded save. Per-user defaults cannot be
// changed safely from RCON because mods may assume a player caused the event.
type LiveValue = ModSettings['startup'][string]['value'];
type LiveChange = {
	scope: 'runtime-global';
	name: string;
	value: LiveValue;
	expected: LiveValue;
};

async function applyOwnedSettings(
	server: ManagedServer,
	owner: string,
	changes: LiveChange[]
): Promise<number> {
	const payload = luaString(JSON.stringify(changes));
	const luaOwner = luaString(owner);
	const raw = await rconScript(
		server,
		`/silent-command __${owner}__ local changes = helpers.json_to_table(${payload})
local ok, result = pcall(function()
  if script.mod_name ~= ${luaOwner} then error("Wrong mod context", 0) end
  local function same(actual, expected)
    if type(actual) ~= type(expected) then return false end
    if type(actual) ~= "table" then return actual == expected end
    return (actual.r or actual[1] or 0) == (expected.r or expected[1] or 0) and
      (actual.g or actual[2] or 0) == (expected.g or expected[2] or 0) and
      (actual.b or actual[3] or 0) == (expected.b or expected[3] or 0) and
      (actual.a or actual[4] or 1) == (expected.a or expected[4] or 1)
  end
  local changed = 0
  for _, change in ipairs(changes) do
    local prototype = prototypes.mod_setting[change.name]
    if not prototype or prototype.mod ~= ${luaOwner} or prototype.setting_type ~= change.scope then
      error("Setting owner changed: " .. change.name, 0)
    end
    local target = settings.global
    if not same(target[change.name].value, change.value) then
      if not same(target[change.name].value, change.expected) then
        error("Setting changed during update: " .. change.name, 0)
      end
      target[change.name] = { value = change.value }
      if not same(target[change.name].value, change.value) then
        error("Setting was not retained: " .. change.name, 0)
      end
      changed = changed + 1
    end
  end
  return changed
end)
rcon.print(helpers.table_to_json(ok and { ok = true, count = result } or
  { ok = false, error = tostring(result) }))`.replaceAll(/\s+/gu, ' ')
	);
	const response = z
		.object({
			ok: z.boolean(),
			count: z.number().int().nonnegative().optional(),
			error: z.string().optional()
		})
		.parse(JSON.parse(raw.trim()));
	if (!response.ok || response.count === undefined || response.count > changes.length) {
		throw new Error(response.error ?? 'Owned settings update did not complete');
	}
	return response.count;
}

export async function saveLiveModSettings(
	server: ManagedServer,
	changes: Partial<ModSettings>
): Promise<number> {
	const patch = modSettingsSchema.parse(changes);
	if (Object.keys(patch.startup).length) {
		throw new ServerError(409, 'Startup mod settings require a stopped server');
	}
	if (Object.keys(patch['runtime-per-user']).length) {
		throw new ServerError(409, 'Per-user mod settings cannot be changed through RCON');
	}
	if (!(await serverStatus(server)).running) {
		throw new ServerError(409, 'Start this server to change live mod settings');
	}
	const count = Object.keys(patch['runtime-global']).length;
	if (count === 0) return 0;
	const payload = luaString(JSON.stringify(patch));
	const raw = await rconScript(
		server,
		`/silent-command local changes = helpers.json_to_table(${payload})
local ok, result = pcall(function()
  local pending = {}
  local function invalid(message) error(message, 0) end
  local function stage(scope, source, target)
    for name, setting in pairs(source) do
      local prototype = prototypes.mod_setting[name]
      if not prototype or prototype.setting_type ~= scope or not target[name] then
        invalid("Unknown " .. scope .. " setting: " .. name)
      end
      local value = setting.value
      local kind = prototype.type
      if kind == "bool-setting" then
        if type(value) ~= "boolean" then invalid("Expected boolean: " .. name) end
      elseif kind == "int-setting" or kind == "double-setting" then
        if type(value) ~= "number" or (kind == "int-setting" and value % 1 ~= 0) then
          invalid("Expected " .. kind .. ": " .. name)
        end
        if prototype.minimum_value and value < prototype.minimum_value then
          invalid("Below minimum: " .. name)
        end
        if prototype.maximum_value and value > prototype.maximum_value then
          invalid("Above maximum: " .. name)
        end
      elseif kind == "string-setting" then
        if type(value) ~= "string" then invalid("Expected string: " .. name) end
        if value == "" and prototype.allow_blank == false then invalid("Blank setting: " .. name) end
      elseif kind == "color-setting" then
        if type(value) ~= "table" or type(value.r) ~= "number" or
          type(value.g) ~= "number" or type(value.b) ~= "number" or
          (value.a ~= nil and type(value.a) ~= "number") then
          invalid("Expected color: " .. name)
        end
      else
        invalid("Unsupported setting type: " .. name)
      end
      if prototype.allowed_values then
        local allowed = false
        for _, option in ipairs(prototype.allowed_values) do
          if option == value then allowed = true break end
        end
        if not allowed then invalid("Value is not allowed: " .. name) end
      end
      local previous = target[name].value
      if type(previous) == "table" then
        previous = { r = previous.r or previous[1] or 0, g = previous.g or previous[2] or 0,
          b = previous.b or previous[3] or 0, a = previous.a or previous[4] or 1 }
      end
      pending[#pending + 1] = {
        owner = prototype.mod, scope = scope, name = name, previous = previous
      }
    end
  end
  if next(changes.startup) then invalid("Startup settings require a stopped server") end
  if next(changes["runtime-per-user"]) then invalid("Per-user settings require a player") end
  stage("runtime-global", changes["runtime-global"], settings.global)
  return pending
end)
rcon.print(helpers.table_to_json(ok and { ok = true, items = result } or
  { ok = false, error = tostring(result) }))`.replaceAll(/\s+/gu, ' ')
	);
	const response = z
		.object({
			ok: z.boolean(),
			items: z
				.array(
					z.object({
						owner: z.string(),
						scope: z.literal('runtime-global'),
						name: z.string(),
						previous: z.unknown()
					})
				)
				.optional(),
			error: z.string().optional()
		})
		.parse(JSON.parse(raw.trim()));
	if (!response.ok) throw new ServerError(400, response.error ?? 'Invalid live mod settings');
	if (response.items?.length !== count)
		throw new Error('Live mod settings validation count did not match');
	const groups = new Map<string, { current: LiveChange[]; previous: LiveChange[] }>();
	const seen = new Set<string>();
	for (const item of response.items) {
		if (!validModName(item.owner) || !/^[A-Za-z0-9_-]+$/u.test(item.owner))
			throw new Error('Invalid mod setting owner');
		if (seen.has(item.name)) throw new Error('Duplicate live mod setting');
		seen.add(item.name);
		const value = patch['runtime-global'][item.name]?.value;
		if (value === undefined) throw new Error('Unexpected live mod setting');
		const previousSetting = modSettingsSchema.parse({
			'runtime-global': { [item.name]: { value: item.previous } }
		})['runtime-global'][item.name];
		if (!previousSetting) throw new Error('Missing previous live mod setting');
		const previous = previousSetting.value;
		const group = groups.get(item.owner) ?? { current: [], previous: [] };
		group.current.push({ scope: item.scope, name: item.name, value, expected: previous });
		group.previous.push({ scope: item.scope, name: item.name, value: previous, expected: value });
		groups.set(item.owner, group);
	}
	let changed = 0;
	const completed: string[] = [];
	for (const [owner, group] of groups) {
		try {
			changed += await applyOwnedSettings(server, owner, group.current);
			completed.push(owner);
		} catch (cause) {
			const reason = (cause instanceof Error ? cause.message : String(cause)).split(/\r?\n/u, 1)[0];
			const rollbackFailed: string[] = [];
			for (const rollbackOwner of [owner, ...completed.reverse()]) {
				const rollbackGroup = groups.get(rollbackOwner);
				if (!rollbackGroup) {
					rollbackFailed.push(rollbackOwner);
					continue;
				}
				try {
					await applyOwnedSettings(server, rollbackOwner, rollbackGroup.previous);
				} catch {
					rollbackFailed.push(rollbackOwner);
				}
			}
			if (rollbackFailed.length) {
				throw new ServerError(
					502,
					`${owner}: ${reason}; rollback failed for ${rollbackFailed.join(', ')}`
				);
			}
			throw new ServerError(502, `${owner}: ${reason}; previous values were restored`);
		}
	}
	return changed;
}
