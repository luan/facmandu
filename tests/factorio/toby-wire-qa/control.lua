-- Run only on a new, isolated native scenario. The runner copies action.lua
-- as factory-action.lua with `return action` appended; no player save is loaded.
local action=require('factory-action')
script.on_init(function()
 local ok,message=pcall(function()
  local surface,force=game.surfaces.nauvis,game.forces.player
  surface.request_to_generate_chunks({0,0},1);surface.force_generate_chunk_requests()
  local tiles={}
  for x=-16,32 do for y=-8,8 do tiles[#tiles+1]={name='grass-1',position={x=x,y=y}} end end
  surface.set_tiles(tiles)
  for _,e in ipairs(surface.find_entities_filtered{area={{-16,-8},{32,8}},type={'tree','simple-entity'}}) do e.destroy() end
  local a=assert(surface.create_entity{name='medium-electric-pole',position={0.5,0.5},force=force})
  local b=assert(surface.create_entity{name='entity-ghost',inner_name='medium-electric-pole',position={7.5,0.5},force=force})
  local other=assert(surface.create_entity{name='medium-electric-pole',position={-7.5,0.5},force=force})
  local far=assert(surface.create_entity{name='entity-ghost',inner_name='medium-electric-pole',position={25.5,0.5},force=force})
  local id=defines.wire_connector_id.pole_copper
  local ca,co=a.get_wire_connector(id,true),other.get_wire_connector(id,true)
  assert(ca.is_connected_to(co) or ca.connect_to(co,true,defines.wire_origin.player))
  local cb=b.get_wire_connector(id,false)
  if cb and ca.is_connected_to(cb) then ca.disconnect_from(cb) end
  local function endpoint(e) return {unitNumber=e.unit_number,name=e.type=='entity-ghost' and e.ghost_name or e.name,position=e.position,connectorId=id} end
  local request={operation='wire_inspect',force=force.name,surface=surface.name,source=endpoint(a),target=endpoint(b)}
  local batch=action{operation='wire_inspect_batch',force=force.name,surface=surface.name,connections={{source=endpoint(a),target=endpoint(b)},{source=endpoint(a),target=endpoint(far)}}}
  assert(#batch.connections==2 and batch.connections[1].ok and batch.connections[2].ok)
  assert(batch.connections[1].result.tick==batch.tick and batch.connections[2].result.tick==batch.tick and not batch.connections[1].result.connected)
  local before=action(request)
  assert(not before.connected and not before.sourceGhost and before.targetGhost)
  request.operation='wire_connect';request.expectedTick=before.tick;request.expectedConnected=before.connected;request.expectedSourceGhost=before.sourceGhost;request.expectedTargetGhost=before.targetGhost
  assert(action(request).connected and ca.is_connected_to(co),'Existing wires must survive')
  assert(not pcall(action,request),'A concurrent connection must reject the stale snapshot')
  request.operation='wire_inspect';request.target=endpoint(far)
  local distant=action(request)
  request.operation='wire_connect';request.expectedConnected=distant.connected
  assert(not pcall(action,request),'Native reach must reject the distant connection')
  request.target=endpoint(b);request.force='enemy'
  assert(not pcall(action,request),'Other forces cannot use these endpoints')
  return {passed=true,batch_read_same_tick=true,native=script.active_mods.base,connected_ghost=true,existing_wire_preserved=true,stale_connection_rejected=true,reach_enforced=true,force_enforced=true}
 end)
 local result=ok and message or {passed=false,error=tostring(message)}
 log('TOBY_WIRE_QA '..helpers.table_to_json(result))
 helpers.write_file('toby-wire-qa.json',helpers.table_to_json(result),false)
end)
