import { lauxlib, lua, lualib, to_jsstring, to_luastring } from 'fengari';

// Runs in a separate Node process with a bounded heap, no inherited credentials
// and a parent deadline. Lua receives data, never game or host capabilities.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const state = lauxlib.luaL_newstate();
lualib.luaL_openlibs(state);
for (const name of [
	'os',
	'io',
	'package',
	'debug',
	'require',
	'load',
	'loadfile',
	'dofile',
	'collectgarbage',
	'print'
]) {
	lua.lua_pushnil(state);
	lua.lua_setglobal(state, to_luastring(name));
}
// These C helpers can allocate a huge string before an instruction hook runs.
for (const [library, fields] of [
	['string', ['rep', 'format', 'gsub', 'dump']],
	['table', ['concat']]
]) {
	lua.lua_getglobal(state, to_luastring(library));
	for (const field of fields) {
		lua.lua_pushnil(state);
		lua.lua_setfield(state, -2, to_luastring(field));
	}
	lua.lua_pop(state, 1);
}
function push(value) {
	if (value === null) lua.lua_pushnil(state);
	else if (typeof value === 'string') lua.lua_pushstring(state, to_luastring(value));
	else if (typeof value === 'number') lua.lua_pushnumber(state, value);
	else if (typeof value === 'boolean') lua.lua_pushboolean(state, value);
	else {
		lua.lua_newtable(state);
		for (const [key, entry] of Object.entries(value)) {
			if (Array.isArray(value)) lua.lua_pushinteger(state, Number(key) + 1);
			else lua.lua_pushstring(state, to_luastring(key));
			push(entry);
			lua.lua_settable(state, -3);
		}
	}
}
push(request.design);
lua.lua_setglobal(state, to_luastring('design'));
let remaining = 50000;
lua.lua_sethook(
	state,
	() => {
		if (--remaining <= 0)
			lauxlib.luaL_error(state, to_luastring('Layout program exceeded 500,000 instructions'));
		for (let index = 1; index <= lua.lua_gettop(state); index++) {
			if (lua.lua_type(state, index) === lua.LUA_TSTRING && lua.lua_rawlen(state, index) > 128000)
				lauxlib.luaL_error(state, to_luastring('Layout string exceeds 128,000 bytes'));
		}
	},
	lua.LUA_MASKCOUNT,
	10
);
let nodes = 0;
const arrayFields = new Set(['entities', 'tiles', 'wires', 'filters', 'chunk-filter']);
const ancestors = new Set();
function read(index, field = '', depth = 0) {
	if (++nodes > 20000 || depth > 20) throw Error('Layout output is too large or nested');
	const kind = lua.lua_type(state, index);
	if (kind === lua.LUA_TSTRING) return to_jsstring(lua.lua_tolstring(state, index));
	if (kind === lua.LUA_TNUMBER) return lua.lua_tonumber(state, index);
	if (kind === lua.LUA_TBOOLEAN) return lua.lua_toboolean(state, index);
	if (kind !== lua.LUA_TTABLE) throw Error('Return a layout containing only data');
	index = lua.lua_absindex(state, index);
	const identity = lua.lua_topointer(state, index);
	if (ancestors.has(identity)) throw Error('Layout output contains a cyclic table');
	ancestors.add(identity);
	if (!lua.lua_checkstack(state, 4)) throw Error('Layout output is too deeply nested');
	const entries = [];
	lua.lua_pushnil(state);
	while (lua.lua_next(state, index)) {
		const key =
			lua.lua_type(state, -2) === lua.LUA_TNUMBER
				? lua.lua_tonumber(state, -2)
				: lua.lua_type(state, -2) === lua.LUA_TSTRING
					? to_jsstring(lua.lua_tolstring(state, -2))
					: undefined;
		if (key === undefined || entries.length >= 2000)
			throw Error('Layout table has invalid or too many keys');
		entries.push([key, read(-1, String(key), depth + 1)]);
		lua.lua_pop(state, 1);
	}
	ancestors.delete(identity);
	if (!entries.length) return arrayFields.has(field) ? [] : {};
	if (entries.every(([key]) => typeof key === 'number')) {
		entries.sort(([a], [b]) => a - b);
		if (entries.some(([key], index) => key !== index + 1))
			throw Error('Layout arrays must have consecutive indices');
		return entries.map(([, value]) => value);
	}
	if (entries.some(([key]) => typeof key !== 'string'))
		throw Error('Layout objects must have string keys');
	return Object.fromEntries(entries);
}
try {
	const source = to_luastring(request.program);
	const loaded = lauxlib.luaL_loadbufferx(
		state,
		source,
		source.length,
		to_luastring('layout'),
		to_luastring('t')
	);
	if (loaded !== lua.LUA_OK || lua.lua_pcall(state, 0, 1, 0) !== lua.LUA_OK)
		throw Error(lua.lua_tojsstring(state, -1));
	const output = JSON.stringify({ ok: true, design: read(-1) });
	if (Buffer.byteLength(output) > 128000) throw Error('Layout output exceeds 128,000 bytes');
	process.stdout.write(output);
} catch (error) {
	process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0, 500) }));
} finally {
	lua.lua_close(state);
}
