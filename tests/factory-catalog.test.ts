import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('fluid inspection retains connections when a native storage has no fluid segment', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 defines={entity_status={working=1}}
 script={active_mods={base='2.1.21'}}
 local force={name='player'}
 local connected=false;local fluid=nil
 local pipe={valid=true,name='pipe',type='pipe',force=force,unit_number=1,direction=0,status=1,position={x=.5,y=.5},
  get_fluid_contents=function() return {} end,
  has_fluid_segment=function(index) assert(index==1);return connected end,
  get_fluid_segment_fluid=function(index) assert(connected,'Native storage has no segment');assert(index==1);return fluid end,
  get_fluid_box_pipe_connections=function(index) assert(index==1);return {{position={x=.5,y=.5},target_position={x=1.5,y=.5},flow_direction='input-output'}} end}
 prototypes={entity={pipe={}}}
 local surface={name='nauvis',valid=true,find_entities_filtered=function() return {pipe} end}
 game={forces={player=force},surfaces={nauvis=surface}}
 local inspect=require('scripts.tools.transport_diagnostics').functions.inspect_transport
 local args={force='player',surface='nauvis',x=.5,y=.5,name='pipe'}
 local row=inspect(args)
 assert(row.found and row.has_fluid_segment==false and row.segment_fluid==nil)
 assert(#row.fluid_connections==1 and row.fluid_connections[1].target_position.x==1.5)
 connected=true;row=inspect(args);assert(row.has_fluid_segment and row.segment_fluid==nil)
 fluid={name='water',amount=100,temperature=25};row=inspect(args)
 assert(row.segment_fluid.name=='water' and row.segment_fluid.amount==100)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});

test('belt tracing follows native underground pairs and branches without crossing scope or exceeding its bound', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 defines={entity_status={working=1},inventory={chest=1}}
 local force={name='player',is_chunk_charted=function(_,chunk) return chunk.x<2 end}
 local line={get_item_count=function() return 0 end,get_contents=function() return {} end}
 local function belt(id,x,kind)
  return {valid=true,name='belt',type=kind or 'transport-belt',force=force,unit_number=id,
   direction=4,status=1,position={x=x,y=0.5},prototype={belt_speed=0.03125},
   belt_neighbours={inputs={},outputs={}},get_item_count=function() return 0 end,
   get_max_transport_line_index=function() return 2 end,get_transport_line=function() return line end}
 end
 local start= belt(1,0.5,'underground-belt');start.belt_to_ground_type='input'
 local exit=belt(2,4.5,'underground-belt');exit.belt_to_ground_type='output'
 local split=belt(3,5.5,'splitter');split.splitter_filter='coal';split.splitter_output_priority='left'
 local left,right=belt(4,6.5),belt(5,7.5)
 local foreign,hidden=belt(6,8.5),belt(7,64.5);foreign.force={name='enemy'}
 start.underground_belt_neighbour=exit;exit.belt_neighbours.outputs={split}
 split.belt_neighbours.outputs={left,right};left.belt_neighbours.outputs={start,foreign}
 right.belt_neighbours.outputs={hidden}
 prototypes={entity={belt={}},item={},fluid={}}
 local surface={name='nauvis',valid=true,find_entities_filtered=function() return {start} end}
 game={tick=120,forces={player=force},surfaces={nauvis=surface}}
 local inspect=require('scripts.tools.transport_diagnostics').functions.inspect_transport
 local args={force='player',surface='nauvis',x=0.5,y=0.5,name='belt'}
 assert(not inspect(args).belt_trace)
 args.trace_limit=16
 local trace=inspect(args).belt_trace
 assert(trace.tick==120 and #trace.nodes==5 and not trace.truncated)
 assert(trace.nodes[1].outputs[1]==2 and trace.nodes[2].outputs[1]==3)
 assert(#trace.nodes[3].outputs==2 and trace.nodes[3].filter=='coal')
 assert(trace.nodes[4].outputs[1]==1 and trace.nodes[4].boundary)
 assert(trace.nodes[5].boundary and #trace.nodes[5].outputs==0)
 exit.underground_belt_neighbour=start;start.belt_neighbours.inputs={left,foreign,hidden}
 left.belt_neighbours.inputs={right};right.belt_neighbours.inputs={start}
 surface.find_entities_filtered=function() return {exit} end;args.x=4.5;args.trace_direction='upstream'
 trace=inspect(args).belt_trace
 assert(trace.direction=='upstream' and #trace.nodes==4 and not trace.truncated)
 assert(trace.nodes[1].inputs[1]==2 and trace.nodes[2].inputs[1]==3 and trace.nodes[2].boundary)
 assert(trace.nodes[4].inputs[1]==2 and trace.nodes[1].outputs==nil)
 args.trace_limit=2;trace=inspect(args).belt_trace;assert(trace.truncated and #trace.nodes==2)
 for _,direction in ipairs({'sideways',false,4}) do args.trace_direction=direction;assert(not pcall(inspect,args)) end
 surface.find_entities_filtered=function() return {start} end;args.x=0.5;args.trace_direction=nil
 args.trace_limit=2;trace=inspect(args).belt_trace
 assert(#trace.nodes==2 and trace.truncated and trace.nodes[2].truncated)
 start.underground_belt_neighbour=nil;args.trace_limit=16;trace=inspect(args).belt_trace
 assert(#trace.nodes==1 and trace.nodes[1].unpaired)
 for _,limit in ipairs({0,257,1.5,0/0,math.huge,'2'}) do args.trace_limit=limit;assert(not pcall(inspect,args)) end
 args.trace_limit=16;start.position.x=64.5;args.x=64.5;assert(not pcall(inspect,args))
 start.type='container';start.get_inventory=function() return {get_contents=function() return {{name='coal',count=400,quality='normal'}} end} end
 local chest=inspect(args)
 assert(chest.found and chest.contents.items[1].count==400 and chest.trace_unavailable and not chest.belt_trace)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

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
   force.recipes.plastic.ingredients={{name='coal',type='item',amount=1}}
   force.recipes.plastic.prototype.get_product_amount=function(_,bonus) return 2*(1+bonus) end
   force.recipes.plastic.prototype.maximum_productivity=0.25
   prototypes.entity['chemical-plant'].effect_receiver={base_effect={productivity=0.5}}
   game.surfaces.nauvis.get_property=function() return 1000 end
   local comparison=functions.planning_recipes({force='player',product='plastic-bar',surface='nauvis'}).comparisons[1]
   assert(comparison.machine=='chemical-plant' and comparison.output_per_craft==2.5)
   assert(comparison.output_per_min==150 and comparison.inputs_per_output[1].amount==0.4)
   force.recipes.plastic.prototype.surface_conditions={{property='pressure',min=2000}}
   local unavailable=functions.planning_recipes({force='player',product='plastic-bar',surface='nauvis'})
   assert(unavailable.recipes[1].surface_compatible==false and unavailable.comparisons[1].surface_compatible==false)
   force.recipes.plastic.prototype.surface_conditions=nil
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
 local pipe={valid=true,name='pipe',type='pipe',force=force,unit_number=4,direction=0,position={x=3,y=1},get_fluid_contents=function() return {['molten-copper']=100} end}
 local belt={valid=true,name='transport-belt',type='transport-belt',force=force,unit_number=5,direction=0,position={x=.5,y=1}}
 local solar={valid=true,name='solar-panel',type='solar-panel',force=force,unit_number=1,direction=0,position={x=0,y=0}}
 local surface={name='nauvis',valid=true,find_entities_filtered=function() return {solar,belt,pipe,tank,chest} end}
 game={forces={player=force},surfaces={nauvis=surface}}
 prototypes={entity={}}
 local find=require('scripts.tools.locate').functions.find_entities
 local result=find{force='player',surface='nauvis',x=0,y=0,radius=10,details=true,limit=3}
 assert(result.total==5 and result.shown==3 and result.omitted==2)
 assert(result.entities[1].unit_number==2 and result.entities[1].contents.items[1].count==400)
 assert(result.entities[2].stored_fluids['petroleum-gas']==10000)
 assert(result.entities[3].stored_fluids['molten-copper']==100,'Nearby fluid supplies must remain visible ahead of ordinary belts')
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

test('planner adapters keep private plans and other forces out', () => {
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
   return {name='glass',note=string.rep('中',200),blueprint_strings={'huge omitted string'},top_floor={lines={{machine={amount=8}}}}}
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
 assert(plan.truncated and plan.plan.note==string.rep('中',166))
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

test('Helmod calculations use its native rates and reject unavailable recipes and invalid rates before calling it', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 game={forces={player={name='player',recipes={glass={enabled=true},locked={enabled=false}}}}}
 script={active_mods={helmod='2.3.4'}}
 local calls=0
 local native={interfaces={helmod_interface={get_recipe=true}},call=function(interface,method,input)
  assert(interface=='helmod_interface' and method=='get_recipe' and input.name=='glass' and input.type=='recipe' and input.quality=='normal')
  calls=calls+1
  return {products={{name='glass',type='item',quality='normal',count=input.count*8}},ingredients={{name='sand',type='item',quality='normal',count=input.count*16}}}
 end}
 local tools=require('scripts.tools.mod_planners').provider(native).functions
 assert(tools.mod_integrations{force='player'}.mods.helmod.calculate)
 local result=tools.helmod_recipe{force='player',recipe='glass',crafts_per_minute=15}
 assert(result.products[1].perMinute==120 and result.ingredients[1].perMinute==240 and calls==1)
 for _,rate in ipairs({0,-1,1000001,math.huge,0/0}) do assert(not pcall(tools.helmod_recipe,{force='player',recipe='glass',crafts_per_minute=rate})) end
 for _,recipe in ipairs({'locked','missing'}) do assert(not pcall(tools.helmod_recipe,{force='player',recipe=recipe,crafts_per_minute=15})) end
 assert(calls==1)
 assert(not pcall(tools.solve_factory_plan,{force='player'}))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('native planning prefers Toby and refuses to silently drop unsupported constraints', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 game={forces={player={name='player'}}};script={active_mods={['facmandu-assistant']='0.0.6'}}
 local calls={}
 local native={interfaces={['facmandu-toby-planner']={solve=true},['facmandu-factory-planner']={solve=true}},
  call=function(interface,method,force,player,surface,products,recipes,inputs,maximize)
   calls[#calls+1]=interface
   assert(method=='solve' and force=='player' and player=='Alice' and surface=='nauvis')
   if interface=='facmandu-toby-planner' then
    assert(products[1].machineCount==8 and inputs[1].mode=='maximum' and maximize.name=='iron-plate')
   end
   return {planner=interface,status='solved'}
  end}
 local tools=require('scripts.tools.mod_planners').provider(native).functions
 local args={force='player',player='Alice',surface='nauvis',products={{name='iron-plate',type='item',machineCount=8}},recipes={{name='iron-plate'}},inputs={{name='iron-ore',type='item',perMinute=300,mode='maximum'}},maximize={name='iron-plate',type='item'}}
 assert(tools.mod_integrations{force='player'}.mods.toby.planner.solve)
 assert(tools.solve_factory_plan(args).planner=='facmandu-toby-planner')
 args.recipes[1].modules={}
 assert(not pcall(tools.solve_factory_plan,args) and #calls==1)
 args.recipes[1].modules=nil
 args.inputs[1].temperature=165
 assert(not pcall(tools.solve_factory_plan,args) and #calls==1)
 args.inputs[1].temperature=nil
 native.interfaces['facmandu-toby-planner']=nil
 assert(not pcall(tools.solve_factory_plan,args));args.inputs=nil;args.maximize=nil
 assert(not pcall(tools.solve_factory_plan,args));assert(#calls==1)
 args.products={{name='iron-plate',type='item',perMinute=300}}
 assert(tools.solve_factory_plan(args).planner=='facmandu-factory-planner' and #calls==2)
 args.products={}
 assert(not pcall(tools.solve_factory_plan,args) and #calls==2)
 args.products={{name='iron-plate',type='item',machineCount=8}}
 args.inputs={{name='iron-ore',type='item',beltCount=1.5,belt='transport-belt',beltStack=1,mode='maximum'}}
 args.maximize={name='iron-plate',type='item'}
 native.interfaces['facmandu-toby-planner']={solve=true}
 assert(not pcall(tools.solve_factory_plan,args) and #calls==2)
 native.interfaces['facmandu-toby-planner'].edit_block=true
 assert(tools.mod_integrations{force='player'}.mods.toby.planner.blocks)
 assert(tools.solve_factory_plan(args).planner=='facmandu-toby-planner' and #calls==3)
 args.inputs={{name='custom-electric-power',type='entity',watts=1000000,mode='maximum'}}
 assert(tools.solve_factory_plan(args).planner=='facmandu-toby-planner' and #calls==4)
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

test('logistics coverage distinguishes construction, logistic chests and missing storage without revealing unsafe targets', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 local force={name='player',is_chunk_charted=function(_,chunk) return chunk.x<2 end}
 local function network(id)
  return {network_id=id,cells={{}},all_logistic_robots=0,available_logistic_robots=0,
   all_construction_robots=20,available_construction_robots=0,storage_points={},
   get_contents=function() error('Counts-only inspection must not scan inventories') end}
 end
 local main,other=network(10),network(11)
 force.logistic_networks={nauvis={main,other}}
 local ports={
  {position={x=0,y=0},logistic_cell={logistic_network=main,transmitting=true,construction_radius=4,logistic_radius=2},energy=100},
  {position={x=20,y=0},logistic_cell={logistic_network=other,transmitting=false,construction_radius=4,logistic_radius=2},energy=0}}
 local function entity(name,kind,x,y)
  return {name=name,type=kind,unit_number=x*10+100,position={x=x,y=y},
   bounding_box={left_top={x=x-.5,y=y-.5},right_bottom={x=x+.5,y=y+.5}}}
 end
 local targets={entity('machine','assembling-machine',1.5,.5),entity('edge','assembling-machine',4,.5),
  entity('provider','logistic-container',3.5,.5),entity('guarded','container',34,.5),entity('hidden','container',70,.5)}
 local walking=false;local calls=0
 local surface={name='nauvis',valid=true,is_chunk_generated=function() return true end,
  get_territory_for_chunk=function(c)
   if c.x==1 then return {get_segmented_units=function() return {{valid=true,prototype={name='small-demolisher'}}} end} end
  end,
  find_entities_filtered=function(q)
   assert(walking,'Ordinary network counts must not walk entities')
   assert(q.force=='player')
   if q.type=='roboport' then assert(q.limit==129);return ports end
   assert(q.limit==1001);return targets
  end,
  create_entity=function() error('Coverage is read only') end}
 surface.find_logistic_network_by_position=function(p,f)
  assert(f==force and p.x<32,'Unsafe targets must be excluded before coverage reads');calls=calls+1
  return math.abs(p.x)<=2 and math.abs(p.y)<=2 and main or nil
 end
 surface.find_logistic_networks_by_construction_area=function(p,f)
  assert(f==force and p.x<32,'Unsafe targets must be excluded before coverage reads');calls=calls+1
  return math.abs(p.x)<=4 and math.abs(p.y)<=4 and {main} or {}
 end
 game={tick=123,forces={player=force},surfaces={nauvis=surface}}
 local summary=require('scripts.tools.logistics').functions.logistics_summary
 local a={force='player',surface='nauvis',contents=false}
 assert(summary(a).networks[1].storage_points==0 and calls==0)
 walking=true;a.coverage=true
 local c=summary(a).coverage
 assert(c.primary_network==10 and c.fixed_networks==2 and c.ports==2 and c.active_ports==1)
 assert(c.checked==3 and c.excluded==2 and not c.truncated)
 assert(c.logistic_centers==1 and c.construction_covered==2)
 assert(c.logistic_chests==1 and c.logistic_chests_covered==0)
 assert(#c.uncovered==2 and c.uncovered[1].name=='edge' and c.uncovered[1].kind=='construction')
 assert(c.uncovered[2].name=='provider' and c.uncovered[2].kind=='logistic_chest')
 targets={};for i=1,1001 do targets[i]=entity('machine','assembling-machine',1.5,.5) end
 calls=0;c=summary(a).coverage
 assert(c.truncated and c.checked==1000 and c.construction_covered==1000 and calls<=6000)
 a.coverage='true';assert(not pcall(summary,a))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
