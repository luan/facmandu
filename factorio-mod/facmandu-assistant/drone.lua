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
  -- Retain the old recipe only to keep development saves readable. Toby is automatic.
  if force.recipes[NAME] then force.recipes[NAME].enabled=false end
 end
end
function M.bind(player,entity)
 if not entity or not entity.valid or entity.name~=NAME or entity.force~=player.force then error('Select a Toby drone on your force',0) end
 for index,state in pairs(storage.drones) do
  if state.entity.valid and state.entity==entity and index~=player.index then error('This Toby drone belongs to another player',0) end
 end
 local current=owned(player)
 if current and current.entity~=entity then error('A Toby drone is already assigned to you',0) end
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
 if not state then return {player=player.name,force=force,available=false,note='Toby appears automatically when you join with a character.'} end
 local e=state.entity
 local contents=e.get_inventory(defines.inventory.spider_trunk).get_contents()
 local cargo={}
 for _,item in ipairs(contents) do cargo[#cargo+1]={name=item.name,quality=item.quality,count=item.count} end
 table.sort(cargo,function(a,b) return a.name..a.quality<b.name..b.quality end)
 return {player=player.name,force=force,available=true,unitNumber=e.unit_number,surface=e.surface.name,position={x=e.position.x,y=e.position.y},mode=state.mode,revision=state.revision,destination=e.autopilot_destination,built=state.built or 0,working=state.job and state.job.valid and state.job.ghost_name or nil,cargo=cargo}
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
 state.job=nil
 e.follow_target=nil;e.autopilot_destination=nil
 if operation=='stay' then e.stop_spider() end
 if operation=='follow' then e.follow_target=player.character;e.follow_offset={2,-2}
 elseif operation=='move' then e.autopilot_destination=position end
 state.mode=operation;state.revision=state.revision+1
 return M.read(force,name)
end
local function distance(a,b) return (a.x-b.x)^2+(a.y-b.y)^2 end
local function inventories(player,entity)
 local rows={entity.get_inventory(defines.inventory.spider_trunk),player.get_main_inventory()}
 for _,chest in ipairs(entity.surface.find_entities_filtered{position=player.physical_position,radius=24,type='logistic-container',force=player.force,limit=32}) do
  local mode=chest.prototype.logistic_mode
  if mode=='passive-provider' or mode=='active-provider' or mode=='storage' then rows[#rows+1]=chest.get_inventory(defines.inventory.chest) end
 end
 return rows
end
local function material(sources,ghost)
 local cost=ghost.ghost_prototype.items_to_place_this
 local item=cost and cost[1]
 if not item then return end
 for _,inventory in ipairs(sources) do
  if inventory and inventory.valid then
   for i=1,#inventory do
    local stack=inventory[i]
    -- Encoded vehicles need their entity-data payload imported by a native item
    -- placement path. Leave them intact until that path is supported.
    if stack.valid_for_read and stack.name==item.name and stack.quality.name==ghost.quality.name and stack.count>=(item.count or 1) and not stack.is_item_with_entity_data then
     return stack,inventory,item.count or 1
    end
   end
  end
 end
end
local function return_items(reserved,source,entity)
 for i=1,#reserved do
  local stack=reserved[i]
  if stack.valid_for_read then
   local count=source.valid and source.insert(stack) or 0
   stack.count=stack.count-count
   if stack.valid_for_read then entity.surface.spill_item_stack{position=entity.position,stack=stack,enable_looted=true,force=entity.force};stack.clear() end
  end
 end
 reserved.destroy()
end
local function construct(state,ghost,sources)
 local stack,source,count=material(sources,ghost)
 if not stack then return false end
 local reserved=game.create_inventory(32)
 reserved[1].set_stack(stack);reserved[1].count=count;stack.count=stack.count-count
 -- Like Entourage's construction workers: reserve real items, use native ghost
 -- revival (including configured filters/wires), consume only on success.
 local ok,collisions=pcall(function() return ghost.revive{raise_revive=true,overflow=reserved} end)
 local consumed=(ok and collisions~=nil) or not ghost.valid
 if consumed then reserved[1].count=reserved[1].count-count end
 if ok and collisions~=nil then state.built=(state.built or 0)+1 end
 return_items(reserved,source,state.entity)
 return ok and collisions~=nil
end
local function work(player,state)
 local entity=state.entity
 if state.mode=='move' then return end
 local ghost=state.job
 if ghost and (not ghost.valid or ghost.force~=player.force or ghost.surface~=entity.surface or distance(ghost.position,player.physical_position)>24^2) then state.job=nil;ghost=nil end
 local candidates
 if not ghost then
  candidates=entity.surface.find_entities_filtered{position=entity.position,radius=state.mode=='stay' and 2 or 16,type={'entity-ghost','tile-ghost'},force=player.force,limit=32}
  if #candidates==0 then
   if state.mode=='follow' and entity.follow_target~=player.character then entity.autopilot_destination=nil;entity.follow_target=player.character;entity.follow_offset={2,-2} end
   return
  end
 end
 local sources=inventories(player,entity)
 if not ghost then
  for _,candidate in ipairs(candidates) do
   if distance(candidate.position,player.physical_position)<=24^2 and (candidate~=state.blocked_ghost or game.tick-(state.blocked_tick or 0)>=120) and material(sources,candidate) then state.job=candidate;ghost=candidate;break end
  end
 end
 if ghost then
  entity.follow_target=nil
  if distance(entity.position,ghost.position)<=2^2 then
   if not construct(state,ghost,sources) then state.blocked_ghost=ghost;state.blocked_tick=game.tick end
   state.job=nil;entity.autopilot_destination=nil
  else entity.autopilot_destination=ghost.position end
 elseif state.mode=='follow' and entity.follow_target~=player.character then entity.autopilot_destination=nil;entity.follow_target=player.character;entity.follow_offset={2,-2} end
end
local function ensure(player)
 if owned(player) or not player.connected or not player.character then return end
 local surface=player.physical_surface
 local at=surface.find_non_colliding_position(NAME,player.physical_position,8,0.5)
 if not at then return end
 local entity=surface.create_entity{name=NAME,position=at,force=player.force}
 if entity then
  entity.last_user=player
  M.bind(player,entity)
  local state=owned(player);state.mode='follow';entity.follow_target=player.character;entity.follow_offset={2,-2}
 end
end
function M.tick()
 for index,state in pairs(storage.drones or {}) do
  local e=state.entity
  local player=game.get_player(index)
  if not e.valid or not player or e.force~=player.force then
   if e.valid then e.follow_target=nil;e.autopilot_destination=nil end
   storage.drones[index]=nil
  elseif not player.connected or not player.character then
   state.job=nil;e.follow_target=nil;e.autopilot_destination=nil;e.stop_spider()
  else
   if player.physical_surface~=e.surface and state.mode=='follow' then
    local at=player.physical_surface.find_non_colliding_position(NAME,player.physical_position,8,0.5)
    if at and e.teleport(at,player.physical_surface) then state.job=nil;state.revision=state.revision+1 end
   end
   if player.physical_surface==e.surface then
    if state.mode=='move' and not e.autopilot_destination then state.mode='stay';state.revision=state.revision+1 end
    work(player,state)
   else state.job=nil;e.follow_target=nil;e.autopilot_destination=nil;e.stop_spider() end
  end
 end
 for _,player in pairs(game.players) do ensure(player) end
end
remote.add_interface('facmandu-toby-drone',{read=M.read,command=M.command})
return M
