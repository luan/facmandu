-- New empty native fixture. Only this disposable lab is seeded; no player save is loaded.
script.on_init(function() storage.done=false end)
script.on_nth_tick(30,function()
 if storage.done then return end
 local player=game.connected_players[1]
 if not player then return end
 local available=remote.call('facmandu-blueprint-sandboxes','read',player.force.name,player.name)
 local lab=available.labs[1]
 if not lab then return end -- Enter the upstream sandbox with Shift+B before checking.
 storage.done=true
 local ok,result=pcall(function()
  local surface=game.surfaces[lab.surface]
  local force=player.force
  local first=surface.create_entity{name='constant-combinator',position={10.5,10.5},force=force}
  local second=surface.create_entity{name='constant-combinator',position={12.5,10.5},force=force}
  assert(first.get_wire_connector(defines.wire_connector_id.circuit_green,true).connect_to(second.get_wire_connector(defines.wire_connector_id.circuit_green,true)))
  local inserter=surface.create_entity{name='inserter',position={14.5,10.5},force=force}
  inserter.set_filter(1,'iron-plate');inserter.use_filters=true
  local machine=surface.create_entity{name='assembling-machine-2',position={17.5,10.5},force=force}
  machine.set_recipe('iron-gear-wheel');machine.get_module_inventory().insert{name='speed-module',count=1}
  surface.create_entity{name='steel-chest',position={20.5,10.5},force=force,quality='uncommon'}
  local before_inventory=player.get_main_inventory()
  local before={controller=player.controller_type,force=force.name,position=player.position,items=before_inventory and before_inventory.get_item_count() or 0}
  local researched={} for name,tech in pairs(force.technologies) do researched[name]=tech.researched end
  local exported=remote.call('facmandu-blueprint-sandboxes','export',force.name,player.name,'player',15,10,8)
  assert(#exported.entities==5 and exported.blueprint:sub(1,1)=='0')
  local inventory=game.create_inventory(1)
  local stack=inventory[1];assert(stack.import_stack(exported.blueprint)==0)
  local filters,wires,modules,quality=false,false,false,false
  for _,entity in ipairs(stack.get_blueprint_entities()) do
   if entity.name=='inserter' then filters=entity.use_filters and entity.filters[1].name=='iron-plate' end
   wires=wires or (entity.wires and #entity.wires>0) or false
   if entity.name=='assembling-machine-2' then modules=entity.items and #entity.items>0 end
   if entity.name=='steel-chest' then quality=entity.quality=='uncommon' end
  end
  inventory.destroy()
  assert(filters and wires and modules and quality,'Native settings did not survive export')
  assert(not pcall(remote.call,'facmandu-blueprint-sandboxes','export','enemy',player.name,'player',15,10,8))
  assert(not pcall(remote.call,'facmandu-blueprint-sandboxes','export',force.name,player.name,'player',15,10,33))
  local after_inventory=player.get_main_inventory()
  assert((after_inventory~=nil)==(before_inventory~=nil))
  assert(player.controller_type==before.controller and player.force==force and player.position.x==before.position.x and player.position.y==before.position.y and (after_inventory and after_inventory.get_item_count() or 0)==before.items)
  for name,value in pairs(researched) do assert(force.technologies[name].researched==value) end
  return {passed=true,entities=#exported.entities,filtersPreserved=filters,wiresPreserved=wires,modulesPreserved=modules,qualityPreserved=quality,playerStatePreserved=true,exported=exported}
 end)
 local proof=ok and result or {passed=false,error=tostring(result)}
 log('TOBY_SANDBOX_QA '..helpers.table_to_json(proof))
 helpers.write_file('toby-sandbox-qa.json',helpers.table_to_json(proof),false)
end)
