local M={}
local NAME='toby-drone'
local function player_for(force,name)
 local player=game.get_player(name)
 if not player or player.force.name~=force then error('Choose a player on your force',0) end
 return player
end
local function owned(player)
 local state=(storage.drones or {})[player.index]
 if state and state.entity.valid and state.entity.force==player.force then return state end
end
function M.init()
 storage.drones=storage.drones or {}
 for _,force in pairs(game.forces) do
  local technology=force.technologies['personal-roboport-equipment']
  if technology and technology.researched then force.recipes[NAME].enabled=true end
 end
end
function M.bind(player,entity)
 if not entity or not entity.valid or entity.name~=NAME or entity.force~=player.force then error('Select a Toby drone on your force',0) end
 for index,state in pairs(storage.drones) do
  if state.entity.valid and state.entity==entity and index~=player.index then error('This Toby drone belongs to another player',0) end
 end
 local current=owned(player)
 if current and current.entity~=entity then error('Mine your current Toby drone before assigning another',0) end
 if not current then
  entity.follow_target=nil;entity.autopilot_destination=nil
  entity.enable_logistics_while_moving=true
  storage.drones[player.index]={entity=entity,mode='stay',revision=0}
 end
 return M.read(player.force.name,player.name)
end
function M.built(event)
 local entity=event.entity
 if entity and entity.valid and entity.name==NAME and event.player_index then
  local player=game.get_player(event.player_index)
  if not owned(player) then M.bind(player,entity) end
 end
end
function M.read(force,name)
 local player=player_for(force,name)
 local state=owned(player)
 if not state then return {player=player.name,force=force,available=false,note='Craft and place a Toby drone, or select an unassigned one and claim it in Toby’s Drone tab.'} end
 local e=state.entity
 local contents=e.get_inventory(defines.inventory.spider_trunk).get_contents()
 local cargo={}
 for _,item in ipairs(contents) do cargo[#cargo+1]={name=item.name,quality=item.quality,count=item.count} end
 table.sort(cargo,function(a,b) return a.name..a.quality<b.name..b.quality end)
 return {player=player.name,force=force,available=true,unitNumber=e.unit_number,surface=e.surface.name,position={x=e.position.x,y=e.position.y},mode=state.mode,revision=state.revision,destination=e.autopilot_destination,energy=e.grid and e.grid.available_in_batteries or 0,robots=e.logistic_cell and e.logistic_cell.logistic_network and e.logistic_cell.logistic_network.all_construction_robots or 0,cargo=cargo}
end
function M.command(force,name,operation,expected,position)
 local player=player_for(force,name)
 local state=owned(player)
 if not state then error('No assigned Toby drone',0) end
 if type(expected)~='table' or expected.unitNumber~=state.entity.unit_number or expected.revision~=state.revision or expected.surface~=state.entity.surface.name then error('Toby drone changed; inspect it again',0) end
 if not player.connected or not player.character or player.physical_surface~=state.entity.surface then error('Join the drone’s surface with your character first',0) end
 if operation~='follow' and operation~='stay' and operation~='move' then error('Choose follow, stay or move',0) end
 local e=state.entity
 if operation=='move' then
  if type(position)~='table' or type(position.x)~='number' or type(position.y)~='number' or position.x~=position.x or position.y~=position.y or math.abs(position.x)>1000000 or math.abs(position.y)>1000000 then error('Invalid drone destination',0) end
  if (position.x-e.position.x)^2+(position.y-e.position.y)^2>256^2 then error('Choose a destination within 256 tiles',0) end
  if not player.force.is_chunk_charted(e.surface,{math.floor(position.x/32),math.floor(position.y/32)}) then error('Explore the destination before sending Toby',0) end
 end
 e.follow_target=nil;e.autopilot_destination=nil
 if operation=='follow' then e.follow_target=player.character;e.follow_offset={2,-2}
 elseif operation=='move' then e.autopilot_destination=position end
 state.mode=operation;state.revision=state.revision+1
 return M.read(force,name)
end
function M.tick()
 for index,state in pairs(storage.drones or {}) do
  local e=state.entity
  local player=game.get_player(index)
  if not e.valid or not player or e.force~=player.force then
   if e.valid then e.follow_target=nil;e.autopilot_destination=nil end
   storage.drones[index]=nil
  elseif not player.connected or not player.character or player.physical_surface~=e.surface then
   if state.mode~='stay' then e.follow_target=nil;e.autopilot_destination=nil;state.mode='stay';state.revision=state.revision+1 end
  elseif state.mode=='follow' and e.follow_target~=player.character then e.follow_target=player.character;e.follow_offset={2,-2}
  elseif state.mode=='move' and not e.autopilot_destination then state.mode='stay';state.revision=state.revision+1 end
 end
end
remote.add_interface('facmandu-toby-drone',{read=M.read,command=M.command})
return M
