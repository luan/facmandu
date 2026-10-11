import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('native belt inspection distinguishes a two-lane turn from one-lane side-loading', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 defines={entity_status={working=1}}
 local incoming={valid=true,name='belt',type='transport-belt',direction=0,position={x=0.5,y=1.5}}
 local line={get_item_count=function() return 0 end,get_contents=function() return {} end}
 local belt={valid=true,name='belt',type='transport-belt',direction=4,status=1,position={x=0.5,y=0.5},
  prototype={belt_speed=0.03125},belt_shape='straight',belt_neighbours={inputs={incoming},outputs={}},
  get_item_count=function() return 0 end,get_max_transport_line_index=function() return 2 end,
  get_transport_line=function() return line end}
 prototypes={entity={belt={}}}
 local surface={name='nauvis',valid=true,find_entities_filtered=function() return {belt} end}
 game={forces={player={name='player'}},surfaces={nauvis=surface}}
 local inspect=require('scripts.tools.transport_diagnostics').functions.inspect_transport
 local args={force='player',surface='nauvis',x=0.5,y=0.5,name='belt'}
 local result=inspect(args)
 assert(result.inputs[1].connection=='side-loading' and result.inputs[1].feeds_lanes==1)
 assert(result.inputs[1].direction==0 and result.lane_items_per_second==7.5)
 belt.belt_shape='left';result=inspect(args)
 assert(result.inputs[1].connection=='turn' and result.inputs[1].feeds_lanes==2)
 incoming.direction=4;belt.belt_shape='straight';result=inspect(args)
 assert(result.inputs[1].connection=='inline' and result.inputs[1].feeds_lanes==2)
 belt.type='underground-belt';belt.belt_to_ground_type='input';belt.prototype.max_underground_distance=5
 result=inspect(args);assert(result.underground_type=='input' and not result.underground_neighbour)
 belt.underground_belt_neighbour=incoming;result=inspect(args)
 assert(result.underground_neighbour.position.y==1.5 and result.max_underground_distance==5)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('exact factory centers select the intended belt while overlapping or approximate targets remain ambiguous', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path = ${JSON.stringify(`${root}/?.lua;`)} .. package.path
 local entities={}
 local force={name='player'}
 local surface={name='nauvis',valid=true,find_entities_filtered=function(filter)
  assert(filter.force=='player')
  return entities
 end}
 game={forces={player=force},surfaces={nauvis=surface}}
 prototypes={entity={['transport-belt']={}}}
 local target=require('scripts.tools.target')
 local function belt(id,x) return {valid=true,name='transport-belt',type='transport-belt',unit_number=id,position={x=x,y=0.5}} end
 entities={belt(1,-0.5),belt(2,0.5),belt(3,1.5)}
 local args={force='player',surface='nauvis',name='transport-belt',x=0.5,y=0.5}
 assert(target.find(args).unit_number==2)
 args.x=0
 local entity,miss=target.find(args)
 assert(not entity and miss.ambiguous and #miss.choices==3)
 args.x=0.5
 entities[#entities+1]=belt(4,0.5)
 entity,miss=target.find(args)
 assert(not entity and miss.ambiguous and #miss.choices==2)
 args.unit_number=4
 assert(target.find(args).unit_number==4)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

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
   prototypes.item={['plastic-bar']={},['kr-glass']={},['kr-glass-bottle']={}}
   prototypes.fluid={['glass-melt']={}}
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
   local unknown=functions.planning_recipes({force='player',product='glass'})
   assert(unknown.found==false and unknown.total==0 and unknown.recipes[1]==nil)
   assert(unknown.suggestions[1]=='kr-glass' and unknown.suggestions[2]=='glass-melt')
   local fluid=functions.planning_recipes({force='player',product='glass',type='fluid'})
   assert(#fluid.suggestions==1 and fluid.suggestions[1]=='glass-melt')
   local missing=functions.planning_recipes({force='player',product='absent-product'})
   assert(missing.found==false and #missing.suggestions==0)
   prototypes.item.glass={}
   force.recipes.glass={name='kr-glass',enabled=true,hidden=false,category='smelting',energy=1,
    ingredients={},products={{name='kr-glass',type='item',amount=1}},productivity_bonus=0,
    prototype={get_product_amount=function() return 1 end}}
   local shadowed=functions.planning_recipes({force='player',product='glass'})
   assert(shadowed.total==0 and shadowed.suggestions[1]=='kr-glass')
   game.surfaces.nauvis.find_entities_filtered=function(filter)
    assert(filter.force=='player' and filter.radius==8 and #filter.type==5)
    local function transport(count,id)
     return {name='transport-belt',type='transport-belt',position={x=id+0.5,y=0.5},unit_number=id,direction=4,
      get_item_count=function(stack) assert(stack.name=='kr-glass' and stack.quality=='normal');return count end}
    end
    return {transport(0,1),transport(8,2)}
   end
   local carrying={force='player',surface='nauvis',carrying='kr-glass',x=0,y=0,radius=8}
   local route=functions.find_entities(carrying)
   assert(route.total==1 and route.entities[1].unit_number==2 and route.entities[1].carried_count==8)
   carrying.ghost=true;assert(not pcall(functions.find_entities,carrying))
   carrying.ghost=nil;carrying.radius=nil;assert(not pcall(functions.find_entities,carrying))

  `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('local detailed searches expose finite supplies before scenery without requiring per-entity reads', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 defines={inventory={chest=1}}
 local force={name='player'}
 local chest={valid=true,name='steel-chest',type='container',force=force,unit_number=2,direction=0,position={x=1,y=1},get_inventory=function() return {get_contents=function() return {{name='coal',count=400,quality='normal'}} end} end}
 local tank={valid=true,name='storage-tank',type='storage-tank',force=force,unit_number=3,direction=0,position={x=2,y=1},get_fluid_contents=function() return {['petroleum-gas']=10000} end}
 local solar={valid=true,name='solar-panel',type='solar-panel',force=force,unit_number=1,direction=0,position={x=0,y=0}}
 local surface={name='nauvis',valid=true,find_entities_filtered=function() return {solar,tank,chest} end}
 game={forces={player=force},surfaces={nauvis=surface}}
 prototypes={entity={}}
 local find=require('scripts.tools.locate').functions.find_entities
 local result=find{force='player',surface='nauvis',x=0,y=0,radius=10,details=true,limit=2}
 assert(result.total==3 and result.shown==2 and result.omitted==1)
 assert(result.entities[1].unit_number==2 and result.entities[1].contents.items[1].count==400)
 assert(result.entities[2].stored_fluids['petroleum-gas']==10000)
 assert(not pcall(find,{force='player',surface='nauvis',name='steel-chest',details=true}))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('resource discovery groups charted neutral deposits and rejects unbounded scans', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 local surface={name='nauvis',valid=true}
 local force={name='player',mining_drill_productivity_bonus=0.2,is_chunk_charted=function(_,chunk) return chunk.x<2 end}
 game={forces={player=force},surfaces={nauvis=surface}}
 prototypes={entity={stone={type='resource',resource_category='basic-solid',mineable_properties={mining_time=2.5,products={{name='stone',type='item',amount=2}}}},belt={type='transport-belt'}}}
 surface.find_entities_filtered=function(filter)
  assert(filter.force=='neutral' and filter.type=='resource' and filter.limit==8192)
  return {
   {position={x=10.5,y=10.5},amount=100},
   {position={x=11.5,y=11.5},amount=200},
   {position={x=40.5,y=0.5},amount=400},
   {position={x=100.5,y=0.5},amount=900}
  }
 end
 local find=require('scripts.tools.resources').functions.find_resource_patches
 local args={force='player',surface='nauvis',name='stone',x=0,y=0,radius=256}
 local found=find(args)
 assert(found.charted_tiles==3 and found.total_patches==2 and not found.truncated)
 assert(found.patches[1].tiles==2 and found.patches[1].amount==300)
 assert(found.patches[1].position.x==10.5 and found.patches[1].bounds.right==12)
 assert(found.patches[2].amount==400)
 assert(found.resource.mining_time==2.5 and found.resource.products[1].amount==2)
 assert(found.resource.category=='basic-solid' and found.force_mining_productivity_bonus==0.2)
 args.radius=513;assert(not pcall(find,args))
 args.radius=0/0;assert(not pcall(find,args))
 args.radius=256;args.name='belt';assert(not pcall(find,args))
 args.name='stone';args.x=nil;assert(not pcall(find,args))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('planner adapters use only documented reads and keep private plans and other forces out', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 local force={name='player'};local other={name='other'}
 local players={alice={name='alice',index=1,force=force},bob={name='bob',index=2,force=force},eve={name='eve',index=3,force=other}}
 game={forces={player=force,other=other},get_player=function(name) return players[name] end}
 script={active_mods={factoryplanner='2.1.18',helmod='2.3.4',TaskList='0.6.0'}}
 local native={interfaces={['fp-interface']={export_current_factory=true},helmod_interface={get_models=true}}}
 native.call=function(interface,method,index)
  if interface=='fp-interface' then
   assert(method=='export_current_factory' and index==1)
   return {name='glass',blueprint_strings={'huge omitted string'},top_floor={lines={{machine={amount=8}}}}}
  end
  assert(interface=='helmod_interface' and method=='get_models')
  return {
   own={owner='alice',time=60,products={glass={count=900}}},
   private={owner='bob',share=0},shared={owner='bob',share=1},
   enemy={owner='eve',share=1}
  }
 end
 local tools=require('scripts.tools.mod_planners').provider(native).functions
 local caps=tools.mod_integrations({force='player'})
 assert(caps.mods.factoryplanner.read and not caps.mods.TaskList.read)
 local args={force='player',player='alice',planner='factoryplanner'}
 local plan=tools.read_factory_plan(args)
 assert(plan.plan.top_floor.lines[1].machine.amount==8 and not plan.plan.blueprint_strings)
 args.planner='helmod'
 local list=tools.read_factory_plan(args)
 assert(list.total==2 and #list.plans==2)
 args.id='own';assert(tools.read_factory_plan(args).plan.products.glass.count==900)
 args.id='private';assert(not pcall(tools.read_factory_plan,args))
 args.id='enemy';assert(not pcall(tools.read_factory_plan,args))
 args.player='eve';assert(not pcall(tools.read_factory_plan,args))
 args.player='alice';args.planner='freeplay';assert(not pcall(tools.read_factory_plan,args))
 local unavailable=require('scripts.tools.mod_planners').provider(nil).functions
 args.planner='factoryplanner';assert(not pcall(unavailable.read_factory_plan,args))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('platform request inspection distinguishes automatic sections and reports import locations', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 local sections={sections_count=2,sections={
  {index=1,is_manual=false,active=true,multiplier=1,filters={{value={name='foundation',type='item',quality='normal'},min=112}}},
  {index=2,is_manual=true,active=true,multiplier=1,filters={{value={name='card',type='item',quality='normal'},min=1000,import_from={name='nauvis'},request_from='planet'}}}
 }}
 local force={name='player'}
 local hub={valid=true,name='space-platform-hub',type='space-platform-hub',unit_number=12,force=force,position={x=0,y=0},request_missing_construction_materials=true,get_logistic_sections=function() return sections end}
 local surface={valid=true,name='platform-1',find_entities_filtered=function() return {hub} end}
 prototypes={entity={['space-platform-hub']={}}};game={forces={player=force},surfaces={['platform-1']=surface}}
 local result=require('scripts.tools.logistic_requests').functions.inspect_logistic_requests{force='player',surface='platform-1',x=0,y=0,unit_number=12}
 assert(not result.sections[1].manual and result.sections[2].manual)
 assert(result.sections[2].filters[1].import_from=='nauvis' and result.request_missing_construction_materials)
 hub.request_missing_construction_materials=false
 assert(require('scripts.tools.logistic_requests').functions.inspect_logistic_requests{force='player',surface='platform-1',x=0,y=0,unit_number=12}.request_missing_construction_materials==false)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
