import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('boiler plans use entity input temperature limits in Factorio 2.1.22', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync(
		'factorio-mod/facmandu-assistant/planner/backend/handlers/generator_util.lua',
		'utf8'
	);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 script={active_mods={base='2.1.22'}}
 helpers={compare_versions=function(a,b) return a==b and 0 or -1 end}
 local util=(function() ${source} end)()
 local water={name='water',default_temperature=15,max_temperature=100}
 local steam={name='steam',default_temperature=15,max_temperature=500}
 local input=setmetatable({production_type='input',filter=water,pipe_connections={{connection_category={'default'}}}}, {
  __index=function(_,key) error('Removed fluidbox member: '..key) end})
 local output={production_type='output',filter=steam}
 local boiler={fluidbox_prototypes={input,output},boiler_mode='output-to-separate-pipe',
  target_temperature=165,minimum_input_temperature=40,maximum_input_temperature=80}
 local rows=util.get_boiler_conversions(boiler)
 assert(#rows==1 and rows[1].input==water and rows[1].output==steam)
 assert(rows[1].minimum_temperature==40 and rows[1].maximum_temperature==80 and rows[1].goal_temperature==165)
 boiler.boiler_mode='heat-fluid-inside'
 assert(util.get_boiler_conversions(boiler)[1].goal_temperature==80)
 boiler.minimum_input_temperature=nil;boiler.maximum_input_temperature=nil
 local unlimited=util.get_boiler_conversions(boiler)[1]
 assert(unlimited.minimum_temperature==15 and unlimited.maximum_temperature==100 and unlimited.goal_temperature==100)
 script.active_mods.base='2.1.21'
 input.minimum_temperature=40;input.maximum_temperature=80
 setmetatable(boiler,{__index=function(_,key)
  if key=='minimum_input_temperature' or key=='maximum_input_temperature' then error('Unavailable entity member: '..key) end
 end})
 local legacy=util.get_boiler_conversions(boiler)[1]
 assert(legacy.minimum_temperature==40 and legacy.maximum_temperature==80 and legacy.goal_temperature==80)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});
