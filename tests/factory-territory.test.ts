import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('territory reads native guardians without revealing uncharted chunks and checks complete footprints', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${resolve('src/lib/server/factory-query')}/?.lua;`)}..package.path
 local guardian={valid=true,prototype={name='small-demolisher'}}
 local reads=0
 local force={name='player',is_chunk_charted=function(_,c) return c.x<3 end}
 local surface={name='vulcanus',valid=true,is_chunk_generated=function(c) return c.y>=-1 end,
 get_territory_for_chunk=function(c)
  assert(c.x<3 and c.y>=-1,'Unexplored territory must not be read');reads=reads+1
  if c.x==1 then return {get_segmented_units=function() return {guardian} end} end
 end}
 game={tick=1,forces={player=force},surfaces={vulcanus=surface}}
 local territory=require('scripts.tools.territory')
 local read=territory.reader(force,surface)
 assert(read(0,0).status=='unguarded' and read(1,0).status=='guarded')
 assert(read(1,0).guardians['small-demolisher']==1 and reads==2)
 assert(read(3,0).status=='unexplored' and read(0,-2).status=='unexplored' and reads==2)
 assert(not territory.blocked(read,0,0,32,32),'Touching the border does not cross it')
 assert(territory.blocked(read,30,0,34,4).status=='guarded','A clear center does not make a crossing footprint safe')
 guardian.valid=false
 assert(territory.reader(force,surface)(1,0).status=='cleared')
 surface.get_territory_for_chunk=nil
 assert(territory.reader(force,surface)(0,0).status=='unknown','Missing APIs must not be called safe')
 surface.get_territory_for_chunk=function() return nil end
 local result=require('scripts.tools.territory_inspection').functions.inspect_territory{force='player',surface='vulcanus',x=-.5,y=0,radius=0}
 assert(result.chunks[1].x==-1 and result.chunk_size==32 and result.counts.unguarded==1)
 local large=require('scripts.tools.territory_inspection').functions.inspect_territory{force='player',surface='vulcanus',x=0,y=0,radius=480}
 assert(#large.chunks==961 and large.counts.unexplored>0)
 assert(not pcall(require('scripts.tools.territory_inspection').functions.inspect_territory,{force='player',surface='vulcanus',x=0,y=0,radius=481}))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
