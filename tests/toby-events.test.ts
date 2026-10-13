import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('planner and companion callbacks coexist across replacement, cancellation and reload registration', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/events.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local handlers={};local trace={}
 script={}
 for _,api in ipairs{'on_event','on_nth_tick'} do
  script[api]=function(key,fn) handlers[api..':'..key]=fn end
 end
 for _,api in ipairs{'on_init','on_load','on_configuration_changed'} do
  script[api]=function(fn) handlers[api]=fn end
 end
 package.preload.events=function() ${source} end
 local events=require('events')
 local planner=events.scope('planner');local toby=events.scope('toby')
 local function record(value) return function() trace[#trace+1]=value end end
 planner.on_event({1,2},record('planner'))
 toby.on_event(1,record('toby'))
 planner.on_event(1,record('updated'))
 handlers['on_event:1']({})
 assert(table.concat(trace,',')=='updated,toby')
 trace={};planner.on_event(1,nil);handlers['on_event:1']({})
 assert(table.concat(trace,',')=='toby')
 trace={};handlers['on_event:2']({});assert(table.concat(trace,',')=='planner')
 planner.on_nth_tick(5,function() trace[#trace+1]='scheduled';planner.on_nth_tick(5,nil) end)
 toby.on_nth_tick(5,record('drone'))
 trace={};handlers['on_nth_tick:5']({tick=5})
 assert(table.concat(trace,',')=='scheduled,drone')
 trace={};handlers['on_nth_tick:5']({tick=10});assert(table.concat(trace,',')=='drone')
 toby.on_nth_tick(5,nil);assert(handlers['on_nth_tick:5']==nil)
 planner.on_load(record('planner-load'));toby.on_load(record('toby-load'))
 planner.on_load(record('planner-rebound'))
 trace={};handlers.on_load();assert(table.concat(trace,',')=='planner-rebound,toby-load')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
