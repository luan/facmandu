import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('native lookup contracts declare scope and preserve exact local targets', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
   package.path = ${JSON.stringify(`${root}/?.lua;`)} .. package.path
   defines = {inventory={crafter_input=1},flow_precision_index={},space_platform_state={
    no_path=1,no_schedule=2,on_the_path=3,paused=4,starter_pack_on_the_way=5,
    starter_pack_requested=6,waiting_at_station=7,waiting_for_departure=8,waiting_for_starter_pack=9
   }}
   local functions
   helpers = {table_to_json=function() return '{}' end}
   remote = { add_interface = function(_, value) functions = value end }
   require('scripts.tools.engine').register()
   local manifest = functions.agent_tools_v1()
   for name, entry in pairs(manifest.tools) do
    assert(entry.params.force, name .. ' has no force parameter')
    if name ~= 'list_forces' then assert(entry.params.force:match('^string!'), name) end
   end
   game = {tick=120, ticks_played=120,connected_players={},forces={player={name='player',connected_players={}}}}
   local ok, error = pcall(functions.game_time, {})
   assert(not ok and error == 'force is required')
   assert(functions.game_time({force='player'}).tick == 120)
   prototypes = {entity={['transport-belt']={}}}
   game.surfaces = {nauvis={name='nauvis',valid=true,find_entities_filtered=function(filter)
    assert(filter.force == 'player')
    assert(filter.position.x == 0.5 and filter.position.y == -0.5 and filter.radius == 8)
    if filter.ghost_name then return {} end
    return {{name='transport-belt',type='transport-belt',position={x=0.5,y=-0.5},unit_number=7,direction=4}}
   end}}
   local result = functions.find_entities({force='player',surface='nauvis',name='transport-belt',x=0.5,y=-0.5,radius=8})
   assert(result.entities[1].x == 0.5 and result.entities[1].y == -0.5)
   assert(result.entities[1].unit_number == 7 and result.entities[1].direction == 4)
   assert(result.position.x == 0.5 and result.radius == 8)
   for _, args in ipairs({{x=0}, {x=0,y=0,radius=97}, {x=1000001,y=0,radius=8}}) do
    args.force='player';args.surface='nauvis';args.name='transport-belt'
    assert(not pcall(functions.find_entities,args))
   end
   local player = {name='builder',valid=true,force=game.forces.player,connected=false,
    physical_surface=game.surfaces.nauvis,physical_position={x=0.5,y=-0.5}}
   local outsider = {name='other',valid=true,force={name='other'},connected=true,
    physical_surface=game.surfaces.nauvis,physical_position={x=0.5,y=-0.5}}
   game.players={player,outsider};game.connected_players={outsider}
   game.get_player=function(name) return name=='builder' and player or outsider end
   local locations=functions.locate_player({force='player',all=true})
   assert(locations.total==1 and locations.players[1].player=='builder')
   assert(locations.players[1].connected==false and locations.players[1].x==0.5)
   assert(functions.locate_player({force='player',all=true,connected_only=true}).total==0)
   assert(functions.locate_player({force='player',player='other'}).found==false)
  `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
