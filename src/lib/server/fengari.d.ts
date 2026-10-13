// Bindings used for reviewed query contracts and sandboxed mod settings.
declare module 'fengari' {
	type LuaState = object;
	type LuaHook = () => void;
	export const lua: {
		readonly LUA_OK: number;
		readonly LUA_MASKCOUNT: number;
		readonly LUA_TSTRING: number;
		readonly LUA_TNUMBER: number;
		readonly LUA_TBOOLEAN: number;
		readonly LUA_TTABLE: number;
		lua_type(state: LuaState, index: number): number;
		lua_absindex(state: LuaState, index: number): number;
		lua_tonumber(state: LuaState, index: number): number;
		lua_toboolean(state: LuaState, index: number): boolean;
		lua_next(state: LuaState, index: number): boolean;
		lua_close(state: LuaState): void;
		lua_getglobal(state: LuaState, name: string | Uint8Array): void;
		lua_setglobal(state: LuaState, name: string | Uint8Array): void;
		lua_pushnil(state: LuaState): void;
		lua_setfield(state: LuaState, index: number, name: string | Uint8Array): void;
		lua_pop(state: LuaState, count: number): void;
		lua_pushstring(state: LuaState, value: string | Uint8Array): void;
		lua_pushjsfunction(state: LuaState, fn: (state: LuaState) => number): void;
		lua_sethook(state: LuaState, hook: LuaHook, mask: number, count: number): void;
		lua_tojsstring(state: LuaState, index: number): string;
		luaL_error(state: LuaState, message: string | Uint8Array): never;
	};
	export const lauxlib: {
		luaL_newstate(): LuaState;
		luaL_dostring(state: LuaState, code: string | Uint8Array): number;
	};
	export const lualib: {
		luaL_openlibs(state: LuaState): void;
	};
	export function to_luastring(value: string): Uint8Array;
}
