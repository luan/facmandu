-- Isolated empty-world fixture. Components are test inputs; the drone is normally crafted.
local function record(name,value)
 storage.results[name]=value
 log('TOBY_DRONE_QA '..name..' '..helpers.table_to_json({value=value}))
 helpers.write_file('toby-drone-qa.json',helpers.table_to_json(storage.results),false)
end
local function read(p) return remote.call('facmandu-toby-drone','read',p.force.name,p.name) end
local function command(p,mode,position) return remote.call('facmandu-toby-drone','command',p.force.name,p.name,mode,read(p),position) end
script.on_init(function() storage.results={};game.speed=4 end)
script.on_event(defines.events.on_player_created,function(event)
 local p=game.get_player(event.player_index)
 storage.player=p.index;storage.stage='craft';storage.started=game.tick
 p.surface.always_day=true
 p.surface.request_to_generate_chunks({0,0},4);p.surface.force_generate_chunk_requests()
 p.force.chart(p.surface,{{-128,-128},{128,128}})
 p.teleport({0,0})
 -- Test resources never leave this throwaway profile or reach Beast.
 for _,item in ipairs{{'construction-robot',3},{'personal-roboport-equipment',2},{'processing-unit',10},{'steel-plate',10},{'solar-panel-equipment',12},{'battery-equipment',1},{'transport-belt',3}} do assert(p.insert{name=item[1],count=item[2]}==item[2]) end
 p.force.technologies['personal-roboport-equipment'].researched=true
 local before=p.get_item_count('construction-robot')
 assert(p.begin_crafting{recipe='toby-drone',count=1}==1)
 record('craft_consumes_components',{robotBefore=before,robotAfter=p.get_item_count('construction-robot'),steelAfter=p.get_item_count('steel-plate'),circuitsAfter=p.get_item_count('processing-unit')})
end)
script.on_nth_tick(30,function()
 local p=storage.player and game.get_player(storage.player)
 if not p or not p.connected or storage.stage=='done' then return end
 local ok,message=pcall(function()
  if storage.stage=='craft' and p.get_item_count('toby-drone')==1 then
   local stack=p.get_main_inventory().find_item_stack('toby-drone')
   assert(p.cursor_stack.swap_stack(stack));assert(p.can_build_from_cursor{position={5,0}},'drone deployment blocked');p.build_from_cursor{position={5,0}}
   local state=read(p);assert(state.available)
   local e=p.surface.find_entities_filtered{name='toby-drone'}[1]
   storage.drone=e
   record('crafted_and_assigned',state)
   local function equip(name)
    assert(p.remove_item{name=name,count=1}==1)
    assert(e.grid.put{name=name})
   end
   equip('personal-roboport-equipment');equip('battery-equipment')
   for i=1,12 do equip('solar-panel-equipment') end
   for _,name in ipairs{'construction-robot','transport-belt'} do
    local count=p.get_item_count(name);assert(e.insert{name=name,count=count}==count);assert(p.remove_item{name=name,count=count}==count)
   end
   command(p,'follow')
   p.teleport({30,0})
   storage.stage='walk';storage.started=game.tick
  elseif storage.stage=='walk' and game.tick-storage.started>=120 then
   p.walking_state={walking=false,direction=defines.direction.east}
   storage.stage='follow';storage.started=game.tick
  elseif storage.stage=='follow' and game.tick-storage.started>=300 then
   local state=read(p)
   record('follow_probe',{drone=state,playerPosition={x=p.position.x,y=p.position.y}})
   assert(state.mode=='follow' and state.position.x>5)
   assert((state.position.x-p.position.x)^2+(state.position.y-p.position.y)^2<144)
   record('native_follow',state)
   command(p,'stay')
   record('native_stay',read(p))
   local x=math.floor(p.position.x)+8
   storage.output={x=x,y=4}
   for i=0,2 do assert(p.surface.create_entity{name='entity-ghost',inner_name='transport-belt',position={x+i,4},force=p.force,create_build_effect_smoke=false}) end
   storage.before=read(p)
   command(p,'move',{x=x,y=0})
   storage.stage='construct';storage.started=game.tick
  elseif storage.stage=='construct' then
   local e=storage.drone
   local belts=p.surface.count_entities_filtered{name='transport-belt',area={{storage.output.x-1,3},{storage.output.x+4,6}},force=p.force}
   if belts==3 then
    local state=read(p)
    assert(e.get_item_count('transport-belt')==0)
    record('native_construction',{built=belts,remainingMaterials=e.get_item_count('transport-belt'),remainingGhosts=p.surface.count_entities_filtered{type='entity-ghost',area={{storage.output.x-1,3},{storage.output.x+4,6}}},state=state})
    command(p,'stay');local before=e.position
    storage.stayPosition={x=before.x,y=before.y}
    storage.stage='stationary';storage.started=game.tick
   elseif game.tick-storage.started>3600 then error('Native robots did not construct the loaded belt ghosts: '..helpers.table_to_json(read(p))) end
  elseif storage.stage=='stationary' and game.tick-storage.started>=120 then
   local state=read(p);assert((state.position.x-storage.stayPosition.x)^2+(state.position.y-storage.stayPosition.y)^2<1)
   local stale=storage.before
   assert(not pcall(remote.call,'facmandu-toby-drone','command',p.force.name,p.name,'follow',stale))
   record('stale_command_rejected',true)
   local surface=game.create_surface('toby-qa-other',{width=64,height=64})
   surface.request_to_generate_chunks({0,0},1);surface.force_generate_chunk_requests()
   command(p,'follow');p.teleport({0,0},surface)
   storage.stage='surface';storage.started=game.tick
  elseif storage.stage=='surface' and game.tick-storage.started>=120 then
   local state=read(p);assert(state.surface~='toby-qa-other' and state.mode=='stay')
   record('no_cross_surface_teleport',state)
   record('passed',true);storage.stage='done'
   p.teleport({34,0},game.surfaces.nauvis)
   remote.call('facmandu-assistant','open_player',p.index)
  end
 end)
 if not ok then record('error',tostring(message));storage.stage='done';p.walking_state={walking=false,direction=defines.direction.east} end
end)
