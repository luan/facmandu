local force=game.forces[request.force]
local surface=game.surfaces[request.surface]
if not force or not surface then error('Unknown force or surface',0) end
if request.player then
 local actor=game.get_player(request.player)
 if not actor or not actor.connected or actor.force~=force then error('Player permission changed',0) end
end
local area={left_top={x=request.position.x-request.width/2,y=request.position.y-request.height/2},right_bottom={x=request.position.x+request.width/2,y=request.position.y+request.height/2}}
for x=math.floor(area.left_top.x/32),math.floor((area.right_bottom.x-0.001)/32) do
 for y=math.floor(area.left_top.y/32),math.floor((area.right_bottom.y-0.001)/32) do
  if not surface.is_chunk_generated{x,y} or not force.is_chunk_charted(surface,{x,y}) then error('Choose an explored factory area',0) end
 end
end
if surface.count_entities_filtered{area=area,force=force,limit=1001}>1000 then error('Too many entities; select a smaller factory area',0) end
inventory=game.create_inventory(1)
local stack=inventory[1]
stack.set_stack{name='blueprint'}
local mapping=stack.create_blueprint{surface=surface,force=force,area=area,include_entities=true,include_modules=true,include_station_names=true,include_trains=true,always_include_tiles=false}
local entities=stack.get_blueprint_entities()
if not entities or #entities==0 then error('No blueprintable entities in this area',0) end
if #entities>1000 then error('Too many entities; select a smaller factory area',0) end
local origin
for _,entity in pairs(entities) do
 local original=mapping[entity.entity_number]
 if original and original.valid then
  origin={x=original.position.x-entity.position.x,y=original.position.y-entity.position.y}
  break
 end
end
if not origin then error('Could not locate captured entities',0) end
return {kind='factory-view',force=force.name,surface=surface.name,tick=game.tick,area=area,origin=origin,count=#entities,blueprint=stack.export_stack()}
