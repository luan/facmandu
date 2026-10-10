local supported = {['assembling-machine']=true, furnace=true, ['transport-belt']=true, ['underground-belt']=true, splitter=true, inserter=true, pipe=true, ['pipe-to-ground']=true, ['electric-pole']=true, container=true, ['logistic-container']=true, ['storage-tank']=true, pump=true}
local function unlocked_items(force)
 local items={}
 for _,recipe in pairs(force.recipes) do
  if recipe.enabled then
   for _,product in pairs(recipe.products) do
    if product.type=='item' then items[product.name]=true end
   end
  end
 end
 return items
end
local function unlocked(items,prototype)
 for _,item in pairs(prototype.items_to_place_this or {}) do if items[item.name] then return true end end
 return false
end
local function dimensions(p, direction)
 local w,h=p.tile_width,p.tile_height
 if direction==4 or direction==12 then w,h=h,w end
 return w,h
end
local function construction_report(force,surface,entities,offset,cost)
 local networks={}
 local ready=false
 for _,network in pairs(force.logistic_networks[surface.name] or {}) do
  local covered=0
  for _,entity in ipairs(entities) do
   local position={x=entity.position.x+offset.x,y=entity.position.y+offset.y}
   for _,cell in pairs(network.cells) do
    if cell.transmitting and cell.is_in_construction_range(position) then covered=covered+1;break end
   end
  end
  if covered>0 then
   local materials={}
   local stocked=true
   for _,item in ipairs(cost) do
    local available=network.get_item_count({name=item.name,quality='normal'},'providers')+network.get_item_count({name=item.name,quality='normal'},'storage')
    local missing=math.max(0,item.count-available)
    if missing>0 then stocked=false end
    materials[#materials+1]={name=item.name,required=item.count,available=available,missing=missing,quality='normal'}
   end
   local can_build=covered==#entities and stocked and network.available_construction_robots>0
   ready=ready or can_build
   networks[#networks+1]={id=network.network_id,covered_entities=covered,construction_robots=network.all_construction_robots,available_construction_robots=network.available_construction_robots,materials=materials,ready=can_build}
  end
 end
 table.sort(networks,function(a,b) if a.ready~=b.ready then return a.ready end if a.covered_entities~=b.covered_entities then return a.covered_entities>b.covered_entities end return a.id<b.id end)
 local total=#networks
 while #networks>8 do networks[#networks]=nil end
 -- A positive result requires one network to cover and stock the whole layout; split-network builds need allocation checks.
 return {single_network_ready=ready,entities=#entities,networks=networks,total_networks=total,production_verified=false,note='Normal-quality stock is not reserved. Coverage and materials do not verify power, input/output connections or throughput.'}
end
local function blueprint(request)
 local force=game.forces[request.force]
 if not force then error('Unknown force',0) end
 local actor
 if request.player then
  actor=game.get_player(request.player.name)
  if not actor or not actor.connected or actor.force~=force or (request.operation=='place' and request.player.requireAdmin and not actor.admin) then error('Player permission changed; ask again',0) end
 end
 local available=unlocked_items(force)
 if request.operation=='catalog' then
  local entities={}
  for _,name in ipairs(request.names) do
   local p=prototypes.entity[name]
   if p and supported[p.type] then
    local connections={}
    for _,box in pairs(p.fluidbox_prototypes or {}) do
     for _,connection in pairs(box.pipe_connections) do
      connections[#connections+1]={positions=connection.positions,connection_type=connection.connection_type,flow_direction=connection.flow_direction}
     end
    end
    entities[#entities+1]={name=name,type=p.type,width=p.tile_width,height=p.tile_height,collision_box=p.collision_box,crafting_categories=p.crafting_categories,belt_items_per_second=p.belt_speed and p.belt_speed*480,fluid_connections=connections,unlocked=unlocked(available,p)}
   else
    entities[#entities+1]={name=name,error='Unknown or unsupported production entity'}
   end
  end
  return {force=force.name,entities=entities}
 end
 local entities,preview,boxes={},{},{}
 for i,e in ipairs(request.entities) do
  local p=prototypes.entity[e.name]
  if not p or not supported[p.type] then error('Unknown or unsupported production entity: '..e.name,0) end
  if not unlocked(available,p) then error('Construction item is not unlocked: '..e.name,0) end
  if e.recipe then
   if p.type~='assembling-machine' then error('Only assembling machines accept explicit recipes; furnaces select recipes from their inputs',0) end
   local recipe=force.recipes[e.recipe]
   local compatible=false
   if recipe and recipe.enabled and p.crafting_categories then
    for _,category in pairs(recipe.categories) do if p.crafting_categories[category] then compatible=true end end
   end
   if not compatible then error('Unavailable recipe for '..e.name..': '..e.recipe,0) end
  end
  if e.type and p.type~='underground-belt' then error('Input/output type is only valid for underground belts',0) end
  if p.type=='underground-belt' and not e.type then error('Specify input/output for underground belt',0) end
  local w,h=dimensions(p,e.direction)
  if (e.position.x-w/2)%1~=0 or (e.position.y-h/2)%1~=0 then error('Entity is not aligned to the tile grid: '..e.name,0) end
  local box={x1=e.position.x-w/2,y1=e.position.y-h/2,x2=e.position.x+w/2,y2=e.position.y+h/2}
  for _,b in ipairs(boxes) do
   if box.x1<b.x2 and box.x2>b.x1 and box.y1<b.y2 and box.y2>b.y1 then error('Blueprint entities overlap: '..e.name,0) end
  end
  boxes[#boxes+1]=box
  entities[i]={entity_number=i,name=e.name,position=e.position,direction=e.direction,recipe=e.recipe,type=e.type}
  preview[i]={name=e.name,position=e.position,direction=e.direction,recipe=e.recipe,type=e.type,width=w,height=h}
 end
 inventory=game.create_inventory(1)
 local stack=inventory[1]
 stack.set_stack{name='blueprint'}
 stack.set_blueprint_entities(entities,false)
 local normalized=stack.get_blueprint_entities()
 if not normalized or #normalized~=#entities then error('Factorio rejected blueprint entities',0) end
 for i,e in ipairs(normalized) do
  if e.name~=entities[i].name or e.position.x~=entities[i].position.x or e.position.y~=entities[i].position.y or (e.direction or 0)~=entities[i].direction or e.recipe~=entities[i].recipe or e.type~=entities[i].type then error('Factorio changed blueprint settings; adjust the design',0) end
 end
 stack.label=request.label
 local cost={}
 for _,item in pairs(stack.cost_to_build) do cost[#cost+1]={name=item.name,count=item.count} end
 table.sort(cost,function(a,b)return a.name<b.name end)
 if request.operation=='create' then
  return {kind='blueprint',label=request.label,blueprint=stack.export_stack(),entities=preview,cost=cost}
 end
 local surface=game.surfaces[request.surface]
 if not surface then error('Unknown surface',0) end
 if request.operation=='place' and (request.expectedDesign~=request.design or request.expectedTick>game.tick or game.tick-request.expectedTick>3600) then error('Placement inspection expired; inspect again',0) end
 for _,e in ipairs(entities) do
  if e.recipe then
   for _,condition in pairs(force.recipes[e.recipe].prototype.surface_conditions or {}) do
    local value=surface.get_property(condition.property)
    if (condition.min and value<condition.min) or (condition.max and value>condition.max) then error('Recipe cannot run on this surface: '..e.recipe,0) end
   end
  end
 end
 local blocked={}
 for i,e in ipairs(entities) do
  local position={x=e.position.x+request.position.x,y=e.position.y+request.position.y}
  local b=boxes[i]
  local charted=true
  for x=math.floor((b.x1+request.position.x)/32), math.floor((b.x2-0.001+request.position.x)/32) do
   for y=math.floor((b.y1+request.position.y)/32), math.floor((b.y2-0.001+request.position.y)/32) do
    if not surface.is_chunk_generated{x=x,y=y} or not force.is_chunk_charted(surface,{x=x,y=y}) then charted=false end
   end
  end
  -- Check the real entity collision rules, not the permissive ghost collision mask.
  if not charted or not surface.can_place_entity{name=e.name,position=position,direction=e.direction,force=force,build_check_type=defines.build_check_type.manual} then
   blocked[#blocked+1]={name=e.name,position=position,reason=charted and 'Occupied, unsuitable terrain or surface restrictions' or 'Outside explored, generated terrain'}
  end
  local existing=surface.find_entities_filtered{area={{b.x1+request.position.x,b.y1+request.position.y},{b.x2+request.position.x,b.y2+request.position.y}},type='entity-ghost'}
  if #existing>0 then blocked[#blocked+1]={name=e.name,position=position,reason='An existing construction ghost occupies this position'} end
 end
 if request.operation=='inspect' then return {ready=#blocked==0,blocked=blocked,expectedTick=game.tick,expectedDesign=request.design,surface=surface.name,position=request.position,entities=#entities,cost=cost,construction=construction_report(force,surface,entities,request.position,cost)} end
 if #blocked>0 then error('Placement is blocked at '..blocked[1].name..'; inspect the site again',0) end
 -- Create ghosts at exact inspected coordinates; build_blueprint centers the layout around its cursor.
 local placed=0
 local failure
 for i,e in ipairs(entities) do
  local position={x=e.position.x+request.position.x,y=e.position.y+request.position.y}
  local ok,err=pcall(function()
   local b=boxes[i]
   if surface.count_entities_filtered{area={{b.x1+request.position.x,b.y1+request.position.y},{b.x2+request.position.x,b.y2+request.position.y}},type="entity-ghost"}>0 then error("Site changed during placement",0) end
   if not surface.can_place_entity{name=e.name,position=position,direction=e.direction,force=force,build_check_type=defines.build_check_type.manual} then error('Site changed during placement',0) end
   local ghost=surface.create_entity{name='entity-ghost',inner_name=e.name,position=position,direction=e.direction,force=force,type=e.type,expires=false}
   if not ghost then error('Factorio refused a construction ghost',0) end
   placed=placed+1
   if e.recipe then
    ghost.set_recipe(e.recipe)
    local recipe=ghost.get_recipe()
    if not recipe or recipe.name~=e.recipe then error('Factorio refused the ghost recipe',0) end
   end
   if e.type and ghost.belt_to_ground_type~=e.type then error('Factorio refused the underground belt type',0) end
   if actor then ghost.last_user=actor end
   script.raise_script_built{entity=ghost}
   if not ghost.valid or ghost.type~='entity-ghost' or ghost.ghost_name~=e.name or ghost.position.x~=position.x or ghost.position.y~=position.y then error('A mod changed the placed ghost; inspect the result',0) end
  end)
  if not ok then failure=tostring(err):match('^[^\n]*');break end
 end
 return {operation='place_blueprint',surface=surface.name,position=request.position,requested=#entities,placed=placed,complete=placed==#entities and not failure,error=failure,cost=cost,note='Construction ghosts require real items and player or robot construction. No structures were removed.'}
end
