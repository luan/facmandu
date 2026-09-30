import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import { z } from 'zod';

// Runs a mod's settings.lua in a Lua sandbox with a stubbed data table and
// captures the setting declarations. Libraries that touch the host (os, io,
// debug, package) are removed and runaway files die on an instruction cap,
// so a hostile mod cannot hang or escape the server process.
const PRELUDE = `__defs = {}
__json = (function()
  local function esc(s) return s:gsub('[%c%\\"]', function(c)
    if c == '"' then return '\\\\"' end
    return string.format('\\\\u%04x', string.byte(c)) end) end
  local function enc(v, seen, depth)
    depth = depth or 0
    local t = type(v)
    if t == 'function' and depth < 4 then
      local ok, res = pcall(v)
      if ok then return enc(res, seen, depth + 1) end
      return 'null'
    end
    if t == 'nil' then return 'null'
    elseif t == 'boolean' then return v and 'true' or 'false'
    elseif t == 'number' then return tostring(v)
    elseif t == 'string' then return '"' .. esc(v) .. '"'
    elseif t == 'table' then
      if seen[v] then return 'null' end
      seen[v] = true
      local count, max, isArr = 0, 0, true
      for k, _ in pairs(v) do
        if type(k) ~= 'number' or k < 1 or k % 1 ~= 0 then isArr = false break end
        count = count + 1
        if k > max then max = k end
      end
      if max ~= count then isArr = false end
      local parts = {}
      if isArr then for i = 1, max do parts[#parts+1] = enc(v[i], seen, depth) end return '[' .. table.concat(parts, ',') .. ']'
      else for k, val in pairs(v) do if type(k) == 'string' then parts[#parts+1] = '"' .. esc(k) .. '":' .. enc(val, seen, depth) end end return '{' .. table.concat(parts, ',') .. '}' end
    else return 'null' end
  end
  return function(v) return enc(v, {}) end
end)()
local function vivify()
  return setmetatable(
    {},
    {
      __index = function(t, k)
        local v = vivify()
        rawset(t, k, v)
        return v
      end,
      -- Optional-integration guards like "if APS then APS.setup() end" must not
      -- fail when the other mod is absent; the call dissolves into nothing.
      __call = function() return vivify() end
    }
  )
end
data = { raw = vivify(), extend = function(a, b)
  local items = b ~= nil and b or a
  if type(items) ~= 'table' then return end
  for _, item in ipairs(items) do __defs[#__defs+1] = item end
end }
-- Sibling modules come from the mod archive through __readfile, which the
-- host provides. A module that fails to load degrades to a truthy placeholder
-- so one helper cannot hide every setting in the file.
-- Host access stays out even though unknown globals vivify: the stripped
-- libraries plus file-loading base functions always read as nil.
local blocked = { os = true, io = true, package = true, dofile = true, loadfile = true }
setmetatable(_G, {
  __index = function(_, k)
    if blocked[k] then return nil end
    local v = vivify()
    rawset(_G, k, v)
    return v
  end
})
require = (function()
  local cache = {}
  return function(name)
    if cache[name] ~= nil then return cache[name] end
    local localName = name:gsub('^__' .. (__modname or '') .. '__%.?', '')
    local src = __readfile(localName:gsub('%.', '/') .. '.lua')
    if not src then local v = vivify() cache[name] = v return v end
    local chunk = load(src, '@' .. name)
    if not chunk then local v = vivify() cache[name] = v return v end
    local ok, res = pcall(chunk)
    local value = (ok and res ~= nil) and res or vivify()
    cache[name] = value
    return value
  end
end)()
import = require
serpent = { block = function() return '' end }
mods = {}
log = function() end
debug = {
  getinfo = function()
    local mod = type(__modname) == 'string' and __modname or ''
    return { short_src = '__' .. mod .. '/?.lua' }
  end
}
settings = setmetatable({ startup = {}, global = {}, player = {} }, { __call = function() return {} end })
-- Factorio's data-stage helpers. game_version is overwritten per server; the
-- default only matters before any server version is selected.
helpers = {
  game_version = '2.0.0',
  compare_versions = function(a, b)
    local function parts(v)
      local t = {}
      for p in string.gmatch(tostring(v) .. '.', '(%d*)%.') do t[#t + 1] = tonumber(p) or 0 end
      return t
    end
    local pa, pb = parts(a), parts(b)
    for i = 1, math.max(#pa, #pb) do
      local x, y = pa[i] or 0, pb[i] or 0
      if x ~= y then return x < y and -1 or 1 end
    end
    return 0
  end
}
`;

const luaTypeToKind = {
	'bool-setting': 'boolean',
	'int-setting': 'number',
	'double-setting': 'number',
	'string-setting': 'string',
	'color-setting': 'color'
} as const;

const colorSchema = z.object({
	r: z.number(),
	g: z.number(),
	b: z.number(),
	a: z.number().optional()
});
const settingValueSchema = z.union([z.boolean(), z.number(), z.string(), colorSchema]);
const rawColorSchema = z.union([
	colorSchema.partial(),
	z.tuple([z.number(), z.number(), z.number()]),
	z.tuple([z.number(), z.number(), z.number(), z.number()])
]);

export type LocalisedValue = string | number | boolean | LocalisedValue[];
function validLocalisedValue(value: unknown, depth = 0): value is LocalisedValue {
	if (typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	return (
		Array.isArray(value) &&
		depth < 5 &&
		value.length <= 32 &&
		value.every((part) => validLocalisedValue(part, depth + 1))
	);
}
const localisedValueSchema = z.custom<LocalisedValue>(
	(value) => validLocalisedValue(value) && JSON.stringify(value).length <= 4096
);

const rawDefSchema = z.object({
	type: z.string(),
	name: z.string().min(1),
	setting_type: z.enum(['startup', 'runtime-global', 'runtime-per-user']).catch('startup'),
	default_value: z.union([z.boolean(), z.number(), z.string(), rawColorSchema]).nullish(),
	minimum_value: z.number().optional(),
	maximum_value: z.number().optional(),
	allowed_values: z.unknown().optional(),
	localised_name: z.unknown().optional(),
	localised_description: z.unknown().optional(),
	order: z.string().optional()
});
const nativeDefSchema = rawDefSchema.safeExtend({
	type: z.enum([
		'bool-setting',
		'int-setting',
		'double-setting',
		'string-setting',
		'color-setting'
	]),
	setting_type: z.enum(['startup', 'runtime-global', 'runtime-per-user']),
	default_value: settingValueSchema,
	allowed_values: z.union([z.array(z.string()), z.array(z.number())]).optional()
});

export const settingDefSchema = z.object({
	name: z.string().min(1),
	type: z.enum([
		'bool-setting',
		'int-setting',
		'double-setting',
		'string-setting',
		'color-setting'
	]),
	kind: z.enum(['boolean', 'number', 'string', 'color']),
	settingType: z.enum(['startup', 'runtime-global', 'runtime-per-user']),
	default: settingValueSchema.nullable(),
	minimum: z.number().optional(),
	maximum: z.number().optional(),
	allowed: z.union([z.array(z.string()), z.array(z.number())]).optional(),
	label: z.string().max(256).optional(),
	description: z.string().max(4096).optional(),
	allowedLabels: z.record(z.string(), z.string().max(256)).optional(),
	localisedName: localisedValueSchema.optional(),
	localisedDescription: localisedValueSchema.optional(),
	order: z.string().default('')
});
export type SettingDef = z.infer<typeof settingDefSchema>;

function matchingDefault(
	kind: SettingDef['kind'],
	value: z.infer<typeof rawDefSchema>['default_value']
): SettingDef['default'] {
	if (kind === 'boolean') return typeof value === 'boolean' ? value : null;
	if (kind === 'number') return typeof value === 'number' ? value : null;
	if (kind === 'string') return typeof value === 'string' ? value : null;
	if (Array.isArray(value))
		return { r: value[0] ?? 0, g: value[1] ?? 0, b: value[2] ?? 0, a: value[3] ?? 1 };
	return value !== null && typeof value === 'object'
		? { r: value.r ?? 0, g: value.g ?? 0, b: value.b ?? 0, a: value.a ?? 1 }
		: null;
}

function settingDef(raw: z.infer<typeof rawDefSchema>): SettingDef | null {
	const kind = luaTypeToKind[raw.type as keyof typeof luaTypeToKind] ?? null;
	if (!kind) return null;
	return {
		name: raw.name,
		type: raw.type as SettingDef['type'],
		kind,
		settingType: raw.setting_type,
		default: matchingDefault(kind, raw.default_value),
		...(raw.minimum_value !== undefined ? { minimum: raw.minimum_value } : {}),
		...(raw.maximum_value !== undefined ? { maximum: raw.maximum_value } : {}),
		...(Array.isArray(raw.allowed_values) &&
		(raw.allowed_values.every((item): item is string => typeof item === 'string') ||
			raw.allowed_values.every((item): item is number => typeof item === 'number'))
			? { allowed: raw.allowed_values as string[] | number[] }
			: {}),
		...(localisedValueSchema.safeParse(raw.localised_name).success
			? { localisedName: raw.localised_name as LocalisedValue }
			: {}),
		...(localisedValueSchema.safeParse(raw.localised_description).success
			? { localisedDescription: raw.localised_description as LocalisedValue }
			: {}),
		order: raw.order ?? ''
	};
}

export function parseNativeModSettings(value: unknown): SettingDef[] {
	// Factorio's JSON helper may encode an empty Lua sequence as an object.
	if (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length === 0
	)
		return [];
	const raw = z.array(nativeDefSchema).parse(value);
	return raw.map((item) => {
		const def = settingDef(item);
		if (!def || def.default === null) throw new Error(`Unsupported game mod setting: ${item.name}`);
		return def;
	});
}

export type SiblingReader = (relativePath: string) => string | null;

export function parseModSettingsLua(
	source: string,
	options: {
		readSibling?: SiblingReader;
		gameVersion?: string;
		modName?: string;
	} = {}
): SettingDef[] {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	lua.lua_pushjsfunction(state, (inner) => {
		const name = lua.lua_tojsstring(inner, 1);
		const sibling = options.readSibling?.(name) ?? null;
		if (sibling === null) lua.lua_pushnil(state);
		else lua.lua_pushstring(state, to_luastring(sibling));
		return 1;
	});
	lua.lua_setglobal(state, to_luastring('__readfile'));
	for (const lib of ['os', 'io', 'debug', 'package']) {
		lua.lua_getglobal(state, '_G');
		lua.lua_pushnil(state);
		lua.lua_setfield(state, -2, to_luastring(lib));
		lua.lua_pop(state, 1);
	}
	let steps = 0;
	lua.lua_sethook(
		state,
		() => {
			if (++steps > 500) lua.luaL_error(state, to_luastring('settings.lua instruction cap'));
		},
		lua.LUA_MASKCOUNT,
		1000
	);
	const run = (code: string) => {
		const status = lauxlib.luaL_dostring(state, to_luastring(code));
		if (status !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(state, -1));
	};
	run(PRELUDE);
	// Always defined: the sandbox auto-vivifies unknown globals, so Lua-side
	// nil fallbacks like (__modname or '') would see a table instead.
	const modName =
		options.modName && /^[A-Za-z0-9-_]+$/u.test(options.modName) ? options.modName : '';
	run(`__modname = '${modName}'`);
	if (options.gameVersion && /^[\d.]+$/u.test(options.gameVersion))
		run(`helpers.game_version = '${options.gameVersion}'`);
	run(source);
	run('__out = __json(__defs)');
	lua.lua_getglobal(state, to_luastring('__out'));
	const raw: unknown = JSON.parse(lua.lua_tojsstring(state, -1));
	if (!Array.isArray(raw)) throw new Error('settings.lua exported no settings');
	const defs: SettingDef[] = [];
	for (const entry of raw) {
		const parsed = rawDefSchema.safeParse(entry);
		if (!parsed.success) continue;
		const def = settingDef(parsed.data);
		if (def) defs.push(def);
	}
	return defs;
}
