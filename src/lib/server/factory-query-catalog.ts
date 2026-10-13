import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import { z } from 'zod';
import { factoryBundle, luaString } from './factory-query-bundle';

export const factoryDefinesSchema = z.object({
	inventory: z.record(z.string(), z.number()),
	flow_precision_index: z.record(z.string(), z.number()),
	space_platform_state: z.record(z.string(), z.number())
});
// Only our reviewed sources are evaluated. Game functions are not called here;
// native enum values keep the contracts accurate for the running engine version.
export function factoryCatalog(
	sources: Record<string, string>,
	defines: z.infer<typeof factoryDefinesSchema>
) {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const enums = Object.entries(defines)
		.map(
			([group, values]) =>
				`[ ${luaString(group)} ]={${Object.entries(values)
					.map(([name, value]) => `[ ${luaString(name)} ]=${value}`)
					.join(',')}}`
		)
		.join(',');
	try {
		const status = lauxlib.luaL_dostring(
			state,
			to_luastring(
				`defines={${enums}}\nremote={interfaces={}}\n${factoryBundle(sources)}\nreturn functions.agent_tools_v1()`
			)
		);
		if (status !== lua.LUA_OK)
			throw new Error(
				'Could not load reviewed factory contracts: ' + lua.lua_tojsstring(state, -1)
			);
		function value(index: number): z.infer<ReturnType<typeof z.json>> {
			const type = lua.lua_type(state, index);
			if (type === lua.LUA_TSTRING) return lua.lua_tojsstring(state, index);
			if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(state, index);
			if (type === lua.LUA_TBOOLEAN) return !!lua.lua_toboolean(state, index);
			if (type === lua.LUA_TTABLE) {
				const result: Record<string, z.infer<ReturnType<typeof z.json>>> = {};
				const table = lua.lua_absindex(state, index);
				lua.lua_pushnil(state);
				while (lua.lua_next(state, table)) {
					if (lua.lua_type(state, -2) !== lua.LUA_TSTRING)
						throw new Error('Invalid factory contract key');
					result[lua.lua_tojsstring(state, -2)] = value(-1);
					lua.lua_pop(state, 1);
				}
				return result;
			}
			throw new Error('Invalid factory contract value');
		}
		return value(-1);
	} finally {
		lua.lua_close(state);
	}
}
