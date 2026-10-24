local M={}
local visuals=require('drone-visuals')
local work=require('ghost-work')
local NAME='toby-ghost-drone'
local SPEED=48
local atan2=math.atan2 or math.atan
local function size(request)return #(request.entities or request.edits or {})end
local function distance(a,b)return (a.x-b.x)^2+(a.y-b.y)^2 end
local function player_for(force,name)
 local player=game.get_player(name)
 if not player or player.force.name~=force then error('Choose a player on your force',0) end
 return player
end
local function owned(player)
 local state=(storage.drones or {})[player.index]
 if state and state.entity.valid and state.entity.force==player.force then return state end
end
local function protect(e)
 e.destructible=false;e.minable_flag=false;e.operable=false
 e.enable_logistics_while_moving=false;e.follow_target=nil;e.autopilot_destination=nil
end
local function return_stack(player,surface,position,stack)
 local left=stack.count-player.insert(stack)
 if left>0 then
  -- Preserve item metadata, and keep only the unreturned remainder on retries.
  stack.count=left
  local spilled=surface.spill_item_stack{position=position,stack=stack,enable_looted=true,force=player.force,allow_belts=false}
  assert(spilled and #spilled>0,'Could not return legacy Toby equipment or cargo')
 end
end
local function migrate(player,state)
 local old=state.entity
 if old.name==NAME then protect(old);return end
 protect(old)
 local replacement=old.surface.create_entity{name=NAME,position=old.position,force=player.force}
 if not replacement then return end
 -- Keep the legacy prototype intact until its cargo and equipment are returned.
 local ok,err=pcall(function()
  for _,kind in ipairs{defines.inventory.spider_trunk,defines.inventory.spider_trash}do
   local inventory=old.get_inventory(kind)
   if inventory then for i=1,#inventory do local stack=inventory[i];if stack.valid_for_read then return_stack(player,old.surface,old.position,stack);stack.clear() end end end
  end
  if old.grid and not state.return_equipment then state.return_equipment=old.grid.take_all() end
  while state.return_equipment and #state.return_equipment>0 do local item=state.return_equipment[1];return_stack(player,old.surface,old.position,item);table.remove(state.return_equipment,1)end
  state.return_equipment=nil
 end)
 if not ok then replacement.destroy();state.migration_error=tostring(err);return end
 visuals.clear(state);old.destroy();state.entity=replacement;state.job=nil;state.revision=state.revision+1
 protect(replacement)
end
function M.init()
 storage.drones=storage.drones or {}
 for _,force in pairs(game.forces)do if force.recipes['toby-drone']then force.recipes['toby-drone'].enabled=false end end
 for index,state in pairs(storage.drones)do local player=game.get_player(index);if player and state.entity.valid then migrate(player,state)end end
end
function M.bind(player,entity)
 if not entity or not entity.valid or (entity.name~=NAME and entity.name~='toby-drone') or entity.force~=player.force then error('Select a Toby drone on your force',0)end
 storage.drones=storage.drones or {}
 for index,state in pairs(storage.drones)do if state.entity.valid and state.entity==entity and index~=player.index then error('This Toby drone belongs to another player',0)end end
 local current=owned(player)
 if current and current.entity~=entity then error('A Toby drone is already assigned to you',0)end
 if not current then storage.drones[player.index]={entity=entity,mode='follow',revision=0,ghosts=0} end
 migrate(player,storage.drones[player.index])
 return M.read(player.force.name,player.name)
end
function M.built(event)
 local e=event.entity
 if e and e.valid and (e.name==NAME or e.name=='toby-drone') and event.player_index then local p=game.get_player(event.player_index);if not owned(p)then M.bind(p,e)end end
end
function M.read(force,name)
 local player=player_for(force,name);local state=owned(player)
 if not state then return {player=player.name,force=force,available=false,note='Toby appears automatically with your character.'}end
 local e=state.entity;local job=state.job
 local report
 if job then report={id=job.id,state=job.state,design=job.request.design,surface=job.request.surface,position=job.request.position,requested=size(job.request),placed=job.result and job.result.placed or 0,error=job.error,result=job.result}end
 return {player=player.name,force=force,available=true,unitNumber=e.unit_number,surface=e.surface.name,position={x=e.position.x,y=e.position.y},mode=state.mode,revision=state.revision,destination=state.destination,ghostOnly=e.name==NAME,invulnerable=not e.destructible,ghosts=state.ghosts or 0,job=report,display=state.display or 'idle',activity=state.activity,migrationError=state.migration_error}
end
local function finite(position)
 return type(position)=='table' and type(position.x)=='number' and type(position.y)=='number' and position.x==position.x and position.y==position.y and math.abs(position.x)<=1000000 and math.abs(position.y)<=1000000
end
local function charted(force,surface,position)
 return force.is_chunk_charted(surface,{math.floor(position.x/32),math.floor(position.y/32)})
end
function M.command(force,name,operation,expected,position)
 local player=player_for(force,name);local state=owned(player)
 if not state then error('No assigned Toby drone',0)end
 if type(expected)~='table' or expected.unitNumber~=state.entity.unit_number or expected.revision~=state.revision or expected.surface~=state.entity.surface.name then error('Toby drone changed; inspect it again',0)end
 if not player.connected then error('Player is no longer connected',0)end
 if operation~='follow' and operation~='stay' and operation~='move' then error('Choose follow, stay or move',0)end
 if operation=='move' and (not finite(position)or not charted(player.force,state.entity.surface,position))then error('Choose an explored drone destination',0)end
 if state.job and (state.job.state=='travelling' or state.job.state=='placing')then state.job.state='cancelled' end
 state.destination=operation=='move' and position or nil;state.mode=operation;state.revision=state.revision+1
 return M.read(force,name)
end
local function ensure(player)
 if owned(player) or not player.connected or not player.character then return end
 local surface=player.physical_surface
 local at=surface.find_non_colliding_position(NAME,player.physical_position,8,0.5)
 if at then local e=surface.create_entity{name=NAME,position=at,force=player.force};if e then e.last_user=player;M.bind(player,e)end end
end
function M.submit(request)
 assert(type(request)=='table' and (request.operation=='place' and request.expectedDesign==request.design or request.operation=='entities_edit'),'Inspect this ghost plan before submitting it')
 assert((type(request.entities)=='table' and #request.entities<=4096 or type(request.edits)=='table' and #request.edits>=1 and #request.edits<=16) and #helpers.table_to_json(request)<=240000,'Ghost plan exceeds the native job limit')
 assert(type(request.expectedTick)=='number' and request.expectedTick<=game.tick and game.tick-request.expectedTick<=3600,'Placement inspection expired; inspect again')
 local force=assert(game.forces[request.force],'Force no longer exists');local surface=assert(game.surfaces[request.surface],'Surface no longer exists')
 local state,owner
 for index,candidate in pairs(storage.drones or {})do
  local player=game.get_player(index)
  if candidate.entity.valid and player and player.force==force and (not request.player or player.name==request.player.name)then
   if not state or (candidate.entity.surface==surface and (state.entity.surface~=surface or distance(candidate.entity.position,request.position)<distance(state.entity.position,request.position)))then state=candidate;owner=player end
  end
 end
 assert(state,'Join with Toby once before submitting ghost work')
 assert(state.entity.name==NAME,'Legacy Toby cargo migration must finish before ghost work')
 assert(finite(request.position) and type(request.design)=='string' and #request.design<=64,'Invalid ghost work destination or identity')
 local old=state.job
 if old and old.request.design==request.design and (old.state=='travelling' or old.state=='placing' or old.state=='done' and old.request.expectedTick==request.expectedTick) then return {owner=owner.name,job=M.read(force.name,owner.name).job}end
 assert(not old or (old.state~='travelling' and old.state~='placing'),'Toby is already working; inspect its current job or stop it first')
 if state.entity.surface~=surface then assert(state.entity.teleport(request.position,surface),'Toby could not reach this surface')end
 storage.drone_job_sequence=(storage.drone_job_sequence or 0)+1
 state.job={id=storage.drone_job_sequence,state='travelling',request=table.deepcopy(request)}
 state.mode='work';state.destination=request.position;state.revision=state.revision+1
 state.activity={phase='working',message='Moving to '..request.label..' · '..size(request)..' planned entities'}
 return {owner=owner.name,job=M.read(force.name,owner.name).job}
end
local function fly(state,target)
 local e=state.entity;local d=math.sqrt(distance(e.position,target));if d<=0.3 then return true end
 local step=math.min(d,SPEED/60)
 local next={x=e.position.x+(target.x-e.position.x)*step/d,y=e.position.y+(target.y-e.position.y)*step/d}
 if not charted(e.force,e.surface,next)then error('Toby reached unexplored terrain; choose an explored approach',0)end
 e.torso_orientation=(atan2(target.y-e.position.y,target.x-e.position.x)/math.pi/2+0.25)%1
 assert(e.teleport(next),'Toby could not move to the work site')
 return step==d
end
function M.tick()
 storage.drones=storage.drones or {}
 for _,player in pairs(game.players)do ensure(player)end
 for index,state in pairs(storage.drones)do
  local e=state.entity;local player=game.get_player(index)
  if not e.valid or not player or e.force~=player.force then visuals.clear(state);storage.drones[index]=nil
  elseif e.name==NAME then
   protect(e)
   local ok,err=pcall(function()
    local job=state.job
    if job and job.state=='travelling' then
     if fly(state,state.destination)then
      job.state='placing';state.activity={phase='working',message='Placing ghost plan · '..size(job.request)..' entities'}
      -- Revalidate once at execution; the shared builder checks every target
      -- before any write. The queue preserves the originally authorized intent.
      local request=table.deepcopy(job.request);request.expectedTick=game.tick
      job.result=work.run(request)
      local complete=job.result.complete
      if request.operation=='entities_edit' then complete=true;for _,outcome in ipairs(job.result.outcomes)do if outcome.state=='refused' then complete=false;job.result.error=outcome.error;break end end end
      job.state=complete and 'done' or 'blocked';job.error=job.result.error
      state.ghosts=(state.ghosts or 0)+(job.result.placed or 0)+(job.result.placed_tiles or 0)
      state.activity={phase=job.state=='done' and 'success' or 'error',message=job.state=='done' and (request.operation=='entities_edit' and ('Factory orders scheduled · '..size(request)..' targets') or ('Ghost plan ready · '..state.ghosts..' ghosts placed')) or (job.error or 'Ghost plan is blocked')}
      state.destination=nil;state.mode='stay';state.revision=state.revision+1
     end
    elseif state.mode=='move' and state.destination then if fly(state,state.destination)then state.destination=nil;state.mode='stay';state.revision=state.revision+1 end
    elseif state.mode=='follow' and player.connected and player.character then
     if player.physical_surface~=e.surface then e.teleport(player.physical_position,player.physical_surface)end
     fly(state,{x=player.physical_position.x+2,y=player.physical_position.y-2})
    end
   end)
   if not ok then
    if state.job then state.job.state='blocked';state.job.error=tostring(err):match('[^\n]*')end
    state.destination=nil;state.mode='stay';state.activity={phase='error',message=tostring(err):sub(1,240)}
   end
  end
 end
end
function M.animate()for index,state in pairs(storage.drones or {})do local p=game.get_player(index);if p then visuals.update(p,state)end end end
function M.activity(player,activity)
 local state=owned(player)
 if state and state.job and (state.job.state=='travelling' or state.job.state=='placing')then return end
 visuals.activity(player,activity)
end
remote.add_interface('facmandu-toby-drone',{read=M.read,command=M.command,submit=M.submit,features=function()return {ghostOnly=true,invulnerable=true,speed=SPEED,inventory=false,robots=false}end})
return M
