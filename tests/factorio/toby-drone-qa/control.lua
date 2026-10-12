-- Isolated empty-world fixture. Materials are test inputs; Toby appears automatically.
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
 storage.player=p.index;storage.stage='automatic';storage.started=game.tick
 p.surface.always_day=true
 p.surface.request_to_generate_chunks({0,0},4);p.surface.force_generate_chunk_requests()
 p.force.chart(p.surface,{{-128,-128},{128,128}})
 p.teleport({0,0})
 p.get_main_inventory().clear()
 assert(p.insert{name='transport-belt',count=4}==4)
end)
script.on_nth_tick(30,function()
 local p=storage.player and game.get_player(storage.player)
 if not p or not p.connected or storage.stage=='done' then return end
 local ok,message=pcall(function()
  if storage.stage=='automatic' then
   local state=read(p)
   if not state.available then assert(game.tick-storage.started<120,'Automatic companion did not appear');return end
   assert(state.mode=='follow')
   local e=p.surface.find_entities_filtered{name='toby-drone'}[1]
   storage.drone=e
   assert(#e.grid.equipment==0 and e.get_item_count('construction-robot')==0)
   assert(not p.force.recipes['toby-drone'].enabled)
   record('automatic_no_equipment',state)
   storage.before=state
   p.teleport({30,0});storage.stage='following';storage.started=game.tick
  elseif storage.stage=='following' and game.tick-storage.started>=240 then
   local state=read(p);assert(state.position.x>24)
   record('followed_owner',state)
   command(p,'move',{x=36,y=0});storage.stage='moving';storage.started=game.tick
  elseif storage.stage=='moving' and read(p).mode=='stay' then
   assert(read(p).position.x>34)
   record('native_move',read(p));command(p,'follow')
   for x=30,32 do assert(p.surface.create_entity{name='entity-ghost',inner_name='transport-belt',position={x+0.5,4.5},direction=4,force=p.force}) end
   storage.rare=assert(p.surface.create_entity{name='entity-ghost',inner_name='transport-belt',quality='uncommon',position={33.5,4.5},force=p.force})
   local chest=assert(p.surface.create_entity{name='storage-chest',position={28.5,7.5},force=p.force})
   assert(chest.insert{name='fast-inserter',count=1}==1);storage.provider=chest
   local inventory=game.create_inventory(1);local blueprint=inventory[1]
   blueprint.set_stack{name='blueprint'}
   blueprint.set_blueprint_entities{{entity_number=1,name='fast-inserter',position={0.5,0.5},direction=4,use_filters=true,filters={{index=1,name='iron-plate'}}}}
   local ghosts=blueprint.build_blueprint{surface=p.surface,force=p.force,position={30,8},build_mode=defines.build_mode.forced}
   assert(#ghosts==1);storage.inserter_position=ghosts[1].position;inventory.destroy()
   assert(p.surface.create_entity{name='stone-furnace',position={34,7},force=p.force})
   storage.blocked=assert(p.surface.create_entity{name='entity-ghost',inner_name='transport-belt',position={34.5,7.5},force=p.force})
   storage.stage='construction';storage.started=game.tick
  elseif storage.stage=='construction' then
   local belts=p.surface.count_entities_filtered{name='transport-belt',area={{29,3},{34,6}},force=p.force}
   local inserter=p.surface.find_entity('fast-inserter',storage.inserter_position)
   if belts==3 and inserter and game.tick-storage.started>=240 then
    local e=storage.drone;assert(p.get_item_count('transport-belt')==1)
    assert(storage.rare.valid and storage.blocked.valid)
    assert(storage.provider.get_item_count('fast-inserter')==0)
    local filter=inserter.get_filter(1);assert(filter and filter.name=='iron-plate' and inserter.use_filters)
    assert(#e.grid.equipment==0 and read(p).built==4)
    record('stock_conservation',{builtBelts=belts,remainingBelts=p.get_item_count('transport-belt'),providerInserters=storage.provider.get_item_count('fast-inserter'),rareGhostUntouched=storage.rare.valid,blockedGhostUntouched=storage.blocked.valid,filter=filter,equipment=#e.grid.equipment,state=read(p)})
    command(p,'stay');storage.stayPosition={x=e.position.x,y=e.position.y}
    storage.stage='stationary';storage.started=game.tick
   elseif game.tick-storage.started>3600 then error('Automatic construction did not complete: '..helpers.table_to_json(read(p))) end
  elseif storage.stage=='stationary' and game.tick-storage.started>=120 then
   local state=read(p)
   -- Native spider legs settle after stopping; then the companion must stay put.
   assert(state.mode=='stay' and not state.destination)
   assert((state.position.x-storage.stayPosition.x)^2+(state.position.y-storage.stayPosition.y)^2<36)
   storage.settledPosition={x=state.position.x,y=state.position.y};storage.stage='settled';storage.started=game.tick
  elseif storage.stage=='settled' and game.tick-storage.started>=120 then
   local state=read(p)
   assert((state.position.x-storage.settledPosition.x)^2+(state.position.y-storage.settledPosition.y)^2<0.01)
   assert(not pcall(remote.call,'facmandu-toby-drone','command',p.force.name,p.name,'follow',storage.before))
   record('stale_command_rejected',true)
   local surface=game.create_surface('toby-qa-other',{width=64,height=64})
   surface.request_to_generate_chunks({0,0},1);surface.force_generate_chunk_requests()
   command(p,'follow');p.teleport({0,0},surface)
   storage.stage='surface';storage.started=game.tick
  elseif storage.stage=='surface' and game.tick-storage.started>=120 then
   local state=read(p);assert(state.surface=='toby-qa-other' and state.mode=='follow')
   assert(p.get_item_count('transport-belt')==1)
   record('follows_between_surfaces',state)
   record('passed',true);storage.stage='done'
   p.teleport({30,0},game.surfaces.nauvis)
   remote.call('facmandu-assistant','open_player',p.index)
  end
 end)
 if not ok then record('error',tostring(message));storage.stage='done' end
end)
