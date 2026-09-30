// Minimal bindings for the fengari Lua calls used to read mod settings.lua
// files. Covers only what mod-settings-defs.ts needs, not the whole API.
declare module 'fengari' {
	type LuaState = object;
	type LuaHook = () => void;
	export const lua: {
		readonly LUA_OK: number;
		readonly LUA_MASKCOUNT: number;
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
