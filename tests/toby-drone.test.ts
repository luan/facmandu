import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('Toby owns a separate drone, rejects foreign/stale commands and preserves cargo on departure', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/drone.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 storage={};defines={inventory={spider_trunk=1}};local api
 local force={name='player',technologies={},is_chunk_charted=function(_,chunk) return chunk[1]>=0 end}
 local surface={name='nauvis'}
 local alice={name='alice',index=1,force=force,connected=true,character={},physical_surface=surface}
 local bob={name='bob',index=2,force=force,connected=true,character={},physical_surface=surface}
 game={forces={force},get_player=function(id) if id==1 or id=='alice' then return alice elseif id==2 or id=='bob' then return bob end end}
 remote={add_interface=function(name,interface) assert(name=='facmandu-toby-drone');api=interface end}
 local inventory={get_contents=function() return {{name='transport-belt',quality='normal',count=10}} end}
 local entity={valid=true,name='toby-drone',force=force,unit_number=4,surface=surface,position={x=0,y=0},grid={available_in_batteries=1000},get_inventory=function() return inventory end}
 local module=(function() ${source} end)()
 module.init();module.built{entity=entity,player_index=1}
 local snapshot=api.read('player','alice')
 assert(snapshot.available and snapshot.unitNumber==4 and snapshot.cargo[1].count==10)
 assert(not api.read('player','bob').available)
 assert(not pcall(module.bind,bob,entity))
 assert(not pcall(api.read,'enemy','alice'))
 local next=api.command('player','alice','follow',snapshot)
 assert(next.mode=='follow' and entity.follow_target==alice.character)
 assert(not pcall(api.command,'player','alice','stay',snapshot))
 assert(not pcall(api.command,'player','bob','stay',next))
 assert(not pcall(api.command,'player','alice','move',next,{x=257,y=0}))
 assert(not pcall(api.command,'player','alice','move',next,{x=-2,y=0}))
 assert(not pcall(api.command,'player','alice','move',next,{x=0/0,y=0}))
 assert(entity.follow_target==alice.character and api.read('player','alice').revision==next.revision)
 next=api.command('player','alice','move',next,{x=25,y=2})
 assert(next.mode=='move' and entity.autopilot_destination.x==25 and not entity.follow_target)
 alice.connected=false;module.tick()
 local stopped=api.read('player','alice')
 assert(stopped.mode=='stay' and not entity.follow_target and not entity.autopilot_destination)
 assert(stopped.cargo[1].count==10)
 assert(not pcall(api.command,'player','alice','follow',stopped))
 alice.connected=true;alice.physical_surface={name='platform-1'}
 assert(not pcall(api.command,'player','alice','follow',stopped))
 alice.physical_surface=surface
 api.command('player','alice','follow',stopped)
 alice.character={};module.tick();assert(entity.follow_target==alice.character)
 entity.valid=false;module.tick();assert(not api.read('player','alice').available)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
