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
   local area = functions.find_entities({force='player',surface='nauvis',x=0.5,y=-0.5,radius=8})
   assert(area.entities[1].unit_number == 7)
   assert(area.types['transport-belt'] == 1 and area.omitted == 0)
   game.surfaces.nauvis.find_entities_filtered=function(filter)
    assert(filter.force=='player' and filter.radius==8)
    return {
     {name='transport-belt',type='transport-belt',position={x=0.5,y=-0.5}},
     {name='storage-tank',type='storage-tank',position={x=3.5,y=3.5}}
    }
   end
   local limited=functions.find_entities({force='player',surface='nauvis',x=0.5,y=-0.5,radius=8,limit=1})
   assert(limited.shown==1 and limited.omitted==1 and limited.types['storage-tank']==1)
   assert(not pcall(functions.find_entities,{force='player',surface='nauvis'}))
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
   local force=game.forces.player
   force.get_entity_count=function() return 0 end
   force.logistic_networks={nauvis={{network_id=1,cells={},all_logistic_robots=0,available_logistic_robots=0,
    all_construction_robots=50,available_construction_robots=50,get_contents=function()
     local items={{name='chemical-plant',count=40}}
     for i=1,8 do items[#items+1]={name='part-'..i,count=100} end
     return items
    end,get_item_count=function(stack,inventory)
    assert(stack.quality=='normal' and (inventory=='providers' or inventory=='storage'))
    return stack.name=='chemical-plant' and 20 or 0
   end}}}
   local stock=functions.logistics_summary({force='player',surface='nauvis'}).networks[1]
   assert(stock.distinct_items==9 and stock.contents_shown==8 and stock.contents_omitted==1)
   for _,item in ipairs(stock.contents) do assert(item.name~='chemical-plant') end
   force.recipes={
    plastic={name='plastic',enabled=true,hidden=false,category='chemistry',energy=1,
     ingredients={},products={{name='plastic-bar',type='item',amount=2}},productivity_bonus=0,
     prototype={get_product_amount=function() return 2 end}},
    placement={enabled=true,products={}}
   }
   prototypes.entity={}
   for _,name in ipairs({'chemical-plant','electrochemical-plant'}) do
    prototypes.entity[name]={name=name,type='assembling-machine',items_to_place_this={{name=name,count=1}},get_crafting_speed=function() return 1 end}
   end
   prototypes.get_entity_filtered=function() return prototypes.entity end
   prototypes.get_recipe_filtered=function() return {placement={}} end
   local recipes=functions.planning_recipes({force='player',product='plastic-bar'})
   assert(recipes.recipes[1].machines[1].availability=='craftable')
   assert(recipes.recipes[1].machines[1].construction_stock==40)
   assert(recipes.recipes[1].machines[2].construction_stock==0)
   force.recipes.recycling={name='recycling',enabled=true,hidden=true,category='chemistry',energy=1,
    ingredients={},products={{name='plastic-bar',type='item',amount=1}},productivity_bonus=0,
    prototype={get_product_amount=function() return 1 end}}
   assert(functions.planning_recipes({force='player',product='plastic-bar'}).total==1)
   local exact=functions.planning_recipes({force='player',product='plastic-bar',recipe='recycling'})
   assert(exact.recipes[1].name=='recycling' and exact.recipes[1].hidden)

  `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
