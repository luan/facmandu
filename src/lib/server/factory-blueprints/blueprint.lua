local function supported(p)
 return p and #(p.items_to_place_this or {})>0 and not p.has_flag('not-blueprintable')
end
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
local function inserter_connections(p)
 if p.type~='inserter' then return nil end
 local pickup,drop=p.inserter_pickup_position,p.inserter_drop_position
 local connections={}
 for _,rotation in ipairs({{0,1,0},{4,0,1},{8,-1,0},{12,0,-1}}) do
  local function offset(v) local x,y=v.x or v[1],v.y or v[2];return {x=x*rotation[2]-y*rotation[3],y=x*rotation[3]+y*rotation[2]} end
  connections[#connections+1]={direction=rotation[1],pickup_offset=offset(pickup),drop_offset=offset(drop)}
 end
 return connections
end
local function construction_report(force,surface,entities,offset,cost)
 if surface.platform then
  local hub=surface.platform.hub
  local stock=hub and hub.get_inventory(defines.inventory.hub_main)
  local materials={}
  local ready=stock~=nil
  for _,item in ipairs(cost) do
   local available=stock and stock.get_item_count{name=item.name,quality='normal'} or 0
   local missing=math.max(0,item.count-available)
   if missing>0 then ready=false end
   materials[#materials+1]={name=item.name,required=item.count,available=available,missing=missing,quality='normal'}
  end
  return {mode='platform',hub_stock_ready=ready,materials=materials,production_verified=false,note='The platform builds from hub inventory without robots. Stock is not reserved; power, supply and throughput need verification.'}
 end
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
   if supported(p) then
    local connections={}
    for _,box in pairs(p.fluidbox_prototypes or {}) do
     for _,connection in pairs(box.pipe_connections) do
      connections[#connections+1]={positions=connection.positions,connection_type=connection.connection_type,flow_direction=connection.flow_direction}
     end
    end
    entities[#entities+1]={name=name,type=p.type,width=p.tile_width,height=p.tile_height,collision_box=p.collision_box,crafting_categories=p.crafting_categories,belt_items_per_second=p.belt_speed and p.belt_speed*480,fluid_connections=connections,inserter_connections=inserter_connections(p),unlocked=unlocked(available,p)}
   elseif name=='space-platform-foundation' and prototypes.tile[name] then
    entities[#entities+1]={name=name,type='tile',width=1,height=1,unlocked=unlocked(available,prototypes.tile[name])}
   else
    entities[#entities+1]={name=name,error='Unknown or non-blueprintable entity'}
   end
  end
  return {force=force.name,entities=entities}
 end
 local entities,preview,boxes,warnings={},{},{},{}
 local warned={}
 local function warn(text) if not warned[text] then warnings[#warnings+1]=text;warned[text]=true end end
 local tiles=request.tiles or {}
 local tile_positions={}
 for _,tile in ipairs(tiles) do
  local p=prototypes.tile[tile.name]
  if tile.name~='space-platform-foundation' or not p or not p.can_be_part_of_blueprint then error('Only space-platform-foundation tiles are supported',0) end
  local key=tile.position.x..':'..tile.position.y
  if tile_positions[key] then error('Duplicate blueprint tile',0) end
  tile_positions[key]=true
  if not unlocked(available,p) then
   if request.operation~='create' then error('Construction item is not unlocked: '..tile.name,0) end
   warn('Construction item is not unlocked: '..tile.name)
  end
 end
 for i,e in ipairs(request.entities) do
  local p=prototypes.entity[e.name]
  if not supported(p) then error('Unknown or non-blueprintable entity: '..e.name,0) end
  if not unlocked(available,p) then
   if request.operation~='create' then error('Construction item is not unlocked: '..e.name,0) end
   warn('Construction item is not unlocked: '..e.name)
  end
  if e.recipe then
   if p.type~='assembling-machine' then error('Only assembling machines accept explicit recipes; furnaces select recipes from their inputs',0) end
   local recipe=force.recipes[e.recipe]
   local compatible=false
   if recipe and p.crafting_categories then
    for _,category in pairs(recipe.categories) do if p.crafting_categories[category] then compatible=true end end
   end
   if not compatible then error('Incompatible or unknown recipe for '..e.name..': '..e.recipe,0) end
   if not recipe.enabled then
    if request.operation~='create' then error('Recipe is not unlocked: '..e.recipe,0) end
    warn('Recipe is not unlocked: '..e.recipe)
   end
  end
  local directional_type=p.type=='underground-belt' or p.type=='loader' or p.type=='loader-1x1'
  if e.type and not directional_type then error('Input/output type is only valid for underground belts and loaders',0) end
  if directional_type and not e.type then error('Specify input/output for underground belt or loader',0) end
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
 if #tiles>0 then stack.set_blueprint_tiles(tiles) end
 local normalized_tiles=stack.get_blueprint_tiles() or {}
 if #normalized_tiles~=#tiles then error('Factorio rejected blueprint tiles',0) end
 for _,tile in ipairs(normalized_tiles) do
  if tile.name~='space-platform-foundation' or not tile_positions[tile.position.x..':'..tile.position.y] then error('Factorio changed blueprint tile positions',0) end
 end
 local normalized=stack.get_blueprint_entities() or {}
 if not normalized or #normalized~=#entities then error('Factorio rejected blueprint entities',0) end
 for i,e in ipairs(normalized) do
  if e.name~=entities[i].name or e.position.x~=entities[i].position.x or e.position.y~=entities[i].position.y or (e.direction or 0)~=entities[i].direction or e.recipe~=entities[i].recipe or e.type~=entities[i].type then error('Factorio changed blueprint settings; adjust the design',0) end
 end
 stack.label=request.label
 local cost={}
 for _,item in pairs(stack.cost_to_build) do cost[#cost+1]={name=item.name,count=item.count} end
 table.sort(cost,function(a,b)return a.name<b.name end)
 if request.operation=='create' then
  return {kind='blueprint',label=request.label,blueprint=stack.export_stack(),entities=#preview>0 and preview or nil,tiles=#tiles>0 and tiles or nil,warnings=#warnings>0 and warnings or nil,cost=cost}
 end
 local surface=game.surfaces[request.surface]
 if not surface then error('Unknown surface',0) end
 if surface.platform and surface.platform.force~=force then error('This platform belongs to another force',0) end
 if #tiles>0 and (not surface.platform or surface.platform.force~=force) then error('Foundation requires a space platform belonging to this force',0) end
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
 local pending_tiles={}
 local existing_foundations=0
 for _,tile in ipairs(tiles) do
  local position={x=tile.position.x+request.position.x,y=tile.position.y+request.position.y}
  local existing=surface.get_tile(position)
  if existing.name==tile.name then existing_foundations=existing_foundations+1 else
   if not surface.is_chunk_generated{x=math.floor(position.x/32),y=math.floor(position.y/32)} or not force.is_chunk_charted(surface,{x=math.floor(position.x/32),y=math.floor(position.y/32)}) then
    blocked[#blocked+1]={name=tile.name,position=position,reason='Outside explored, generated terrain'}
   elseif existing.name~='empty-space' or existing.has_tile_ghost() then
    blocked[#blocked+1]={name=tile.name,position=position,reason='Tile is occupied or already has a construction ghost'}
   else pending_tiles[#pending_tiles+1]={name=tile.name,position=position} end
  end
 end
 for i=#cost,1,-1 do
  if cost[i].name=='space-platform-foundation' then
   cost[i].count=cost[i].count-existing_foundations
   if cost[i].count==0 then table.remove(cost,i) end
  end
 end
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
 if request.operation=='inspect' then return {ready=#blocked==0,blocked=blocked,expectedTick=game.tick,expectedDesign=request.design,surface=surface.name,position=request.position,entities=#entities,tiles=#tiles,foundation_pending=#pending_tiles,cost=cost,construction=construction_report(force,surface,entities,request.position,cost)} end
 if #blocked>0 then error('Placement is blocked at '..blocked[1].name..'; inspect the site again',0) end
 -- Create ghosts at exact inspected coordinates; build_blueprint centers the layout around its cursor.
 local placed=0
 local placed_tiles=0
 local failure
 -- Only request foundations; the platform builds them using real hub inventory.
 for _,tile in ipairs(pending_tiles) do
  local ok,err=pcall(function()
   if surface.get_tile(tile.position).name~='empty-space' or surface.get_tile(tile.position).has_tile_ghost() then error('Foundation site changed; inspect again',0) end
   local ghost=surface.create_entity{name='tile-ghost',inner_name=tile.name,position=tile.position,force=force,expires=false}
   if not ghost then error('Factorio refused a foundation ghost',0) end
   placed_tiles=placed_tiles+1
   if actor then ghost.last_user=actor end
   script.raise_script_built{entity=ghost}
   if not ghost.valid and surface.get_tile(tile.position).name~=tile.name then error('A mod changed the foundation ghost',0) end
  end)
  if not ok then failure=tostring(err):match('^[^\n]*');break end
 end
 for i,e in ipairs(entities) do
  if failure then break end
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
   if e.type then
    local actual=ghost.ghost_type=='underground-belt' and ghost.belt_to_ground_type or ghost.loader_type
    if actual~=e.type then error('Factorio refused the input/output type',0) end
   end
   if actor then ghost.last_user=actor end
   script.raise_script_built{entity=ghost}
   if not ghost.valid or ghost.type~='entity-ghost' or ghost.ghost_name~=e.name or ghost.position.x~=position.x or ghost.position.y~=position.y then error('A mod changed the placed ghost; inspect the result',0) end
  end)
  if not ok then failure=tostring(err):match('^[^\n]*');break end
 end
 return {operation='place_blueprint',surface=surface.name,position=request.position,requested=#entities,placed=placed,requested_tiles=#pending_tiles,placed_tiles=placed_tiles,complete=placed==#entities and placed_tiles==#pending_tiles and not failure,error=failure,cost=cost,note=surface.platform and 'Construction requests use real platform hub inventory. No structures were removed.' or 'Construction ghosts require real items and player or robot construction. No structures were removed.'}
end
