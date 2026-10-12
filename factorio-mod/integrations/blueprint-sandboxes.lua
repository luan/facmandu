-- Blueprint Sandboxes 3.3.0: read existing owned labs. Never enter, create,
-- reset or equip a sandbox, or change controllers, research or inventories.
local function labs(force_name,player_name)
 local force,player=game.forces[force_name],game.get_player(player_name)
 local data=player and storage.players[player.index]
 if not force or not player or (player.force~=force and not (data and data.forceName==force.name and player.force.name==data.sandboxForceName)) then error('Choose a player on this force',0) end
 if not data then return player,{} end
 local shared=storage.sandboxForces[data.sandboxForceName]
 local names={player=data.labName,force=shared and shared.labName}
 local found={}
 for kind,name in pairs(names) do
  local surface=game.surfaces[name]
  local owned=storage.labSurfaces[name]
  if surface and Lab.IsLab(surface) and owned and owned.forceName==data.forceName and owned.sandboxForceName==data.sandboxForceName then
   found[kind]={surface=surface,owner=data.forceName,sandboxForce=data.sandboxForceName}
  end
 end
 return player,found
end
local function read(force,player_name)
 local player,found=labs(force,player_name)
 local rows={}
 for _,kind in ipairs{'player','force'} do
  local lab=found[kind]
  if lab then rows[#rows+1]={kind=kind,surface=lab.surface.name,sourceForce=lab.owner,sandboxForce=lab.sandboxForce,ignoreSurfaceConditions=lab.surface.ignore_surface_conditions,daytime=lab.surface.daytime,freezeDaytime=lab.surface.freeze_daytime} end
 end
 return {player=player.name,labs=rows,note='Existing sandbox designs only. Sandbox conditions are not real-world production evidence.'}
end
local function export(force,player_name,kind,x,y,radius)
 local _,found=labs(force,player_name)
 local lab=found[kind]
 if not lab then error('That existing sandbox is unavailable; open it in Blueprint Sandboxes first',0) end
 for _,n in ipairs{x,y,radius} do if type(n)~='number' or n~=n or math.abs(n)>1000000 then error('Invalid sandbox area',0) end end
 if radius<1 or radius>32 then error('Choose a sandbox radius from 1 to 32',0) end
 local area={{x-radius,y-radius},{x+radius,y+radius}}
 local capture_force=Isolation.IsFull() and lab.sandboxForce or lab.owner
 if not game.forces[capture_force] then error('Sandbox force is unavailable',0) end
 if #lab.surface.find_entities_filtered{area=area,force=capture_force,limit=1001}>1000 then error('Sandbox area exceeds 1000 entities; select a smaller area',0) end
 local inventory=game.create_inventory(1)
 local ok,result=pcall(function()
  local stack=inventory[1];stack.set_stack{name='blueprint'}
  stack.create_blueprint{surface=lab.surface,force=capture_force,area=area,include_modules=true,always_include_tiles=false}
  local native=stack.get_blueprint_entities() or {}
  local tiles=stack.get_blueprint_tiles() or {}
  if #native+#tiles==0 then error('No blueprintable sandbox entities or tiles in this area',0) end
  if #native>1000 or #tiles>1024 then error('Sandbox blueprint exceeds the preview limit; select a smaller area',0) end
  local entities={}
  for _,e in ipairs(native) do
   local p=prototypes.entity[e.name];local w,h=p.tile_width,p.tile_height;local direction=e.direction or 0
   if direction==4 or direction==12 then w,h=h,w end
   entities[#entities+1]={name=e.name,position=e.position,direction=direction,type=e.type,recipe=e.recipe,width=w,height=h}
  end
  stack.label='Sandbox · '..player_name..' · '..kind
  local encoded=stack.export_stack()
  if #encoded>48000 then error('Sandbox blueprint is too large; select a smaller area',0) end
  return {kind='blueprint',label=stack.label,blueprint=encoded,entities=#entities>0 and entities or nil,tiles=#tiles>0 and tiles or nil,cost=stack.cost_to_build,warnings={'Sandbox design; real-world connections and surface conditions are not validated.'}}
 end)
 inventory.destroy()
 if not ok then error(result,0) end
 return result
end
remote.add_interface('facmandu-blueprint-sandboxes',{read=read,export=export})
