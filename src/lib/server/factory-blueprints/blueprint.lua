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
local function custom_inserter_range(force,p)
 if p.type~='inserter' or not script or not script.active_mods or not script.active_mods.Smart_Inserters then return nil end
 local function setting(name) return settings.startup[name] and settings.startup[name].value end
 local maximum,mode=setting('si-max-inserters-range'),setting('si-range-adder')
 if type(maximum)~='number' or type(mode)~='string' then error('Smart Inserters range settings are unavailable',0) end
 local function distance(v)
  return math.max(math.abs(math.floor((v.x or v[1])+0.5)),math.abs(math.floor((v.y or v[2])+0.5)))
 end
 local footprint=(math.max(p.tile_width,p.tile_height)-1)/2
 local native=math.max(distance(p.inserter_pickup_position),distance(p.inserter_drop_position))-footprint
 local minimum=1
 if mode=='inserter' or mode=='inserter-with-rebase' then maximum=native
 elseif mode=='incremental' or mode=='incremental-with-rebase' then maximum=maximum+native
 elseif mode~='equal' and mode~='rebase' then error('Unknown Smart Inserters range mode',0) end
 if mode=='rebase' or mode=='incremental-with-rebase' or mode=='inserter-with-rebase' then minimum=native end
 local increment=5
 if setting('si-range-technologies') then
  increment=0
  for level=5,1,-1 do
   local tech=force.technologies['si-unlock-range-'..level]
   if tech and tech.researched and not tech.prototype.hidden then increment=level;break end
  end
 end
 -- Match Smart Inserters 2.1 range settings and researched reach. Other mods need
 -- their own documented range API; native allow_custom_vectors alone has no cap.
 return math.min(maximum,minimum+increment)+footprint
end
local function can_request_ghost(force,surface,entity,position,box,offset)
 if surface.can_place_entity{name=entity.name,position=position,direction=entity.direction,force=force,build_check_type=defines.build_check_type.manual} then return true end
 if surface.platform and surface.platform.force~=force then return false end
 local area={{box.x1+offset.x,box.y1+offset.y},{box.x2+offset.x,box.y2+offset.y}}
 local pending=false
 for _,ghost in ipairs(surface.find_entities_filtered{area=area,type='tile-ghost'}) do
  if ghost.force~=force then return false end
  pending=true
 end
 -- Native blueprint checks require suitable tiles or tile ghosts across the
 -- footprint. Script-ghost checks also permit unsupported terrain; never use them.
 return pending and surface.can_place_entity{name=entity.name,position=position,direction=entity.direction,force=force,build_check_type=defines.build_check_type.blueprint_ghost,forced=false}
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
local function power_report(force,surface,entities,offset,boxes)
 if surface.platform then return nil end -- Platforms share power without ordinary pole coverage.
 local nodes,positions,consumers,sources={},{},{},{}
 local function position(e) return {x=e.position.x+offset.x,y=e.position.y+offset.y} end
 local function add(name,at,index,native)
  local p=prototypes.entity[name]
  local quality=native and native.quality.name or 'normal'
  local key=name..':'..at.x..':'..at.y
  local node=positions[key]
  if not node then
   node={position=at,wire=p.get_max_wire_distance(quality),supply=p.get_supply_area_distance(quality),index=index}
   positions[key]=node;nodes[#nodes+1]=node
  end
  if native and native.type~='entity-ghost' then
   local network=native.electric_network
   local flow=network and network.parent_network.flow_last_tick
   node.anchor=node.anchor or (flow and (flow.maximum_production>0 or flow.accumulator_energy>0)) or false
  end
  return node
 end
 for i,e in ipairs(entities) do
  local p=prototypes.entity[e.name]
  if p.type=='electric-pole' then
   local node=add(e.name,position(e),i)
   -- Bound native searches and graph size; increase only after a larger native fixture meets the tick budget.
   if node.wire>128 or #nodes>128 then return {checked=false,note='Power geometry exceeds this inspection budget; inspect the connections in sections.'} end
  elseif p.electric_energy_source_prototype then
   if p.type=='solar-panel' or p.type=='generator' then sources[#sources+1]=i else consumers[#consumers+1]=i end
  end
 end
 if #consumers==0 then return nil end
 local unknown=false
 local planned=#nodes
 local sites,chunks={},{}
 for i=1,planned do
  sites[#sites+1]={position=nodes[i].position,radius=nodes[i].wire}
 end
 for _,index in ipairs(consumers) do
  local at=position(entities[index]);local key=math.floor(at.x/32)..':'..math.floor(at.y/32)
  if not chunks[key] then chunks[key]=true;sites[#sites+1]={position=at,radius=64} end
 end
 for _,site in ipairs(sites) do
  for _,filter in ipairs{{type='electric-pole'},{ghost_type='electric-pole'}} do
   filter.position,filter.radius,filter.force,filter.limit=site.position,site.radius,force,128
   local found=surface.find_entities_filtered(filter)
   if #found==128 then unknown=true end
   for _,e in ipairs(found) do
    if force.is_chunk_charted(surface,{x=math.floor(e.position.x/32),y=math.floor(e.position.y/32)}) then
     local name=e.type=='entity-ghost' and e.ghost_name or e.name
     if #nodes>=512 and not positions[name..':'..e.position.x..':'..e.position.y] then unknown=true
     else add(name,e.position,nil,e) end
    else unknown=true end
   end
  end
 end
 local function covers(node,index)
  local b=boxes[index];local at=node.position;local r=node.supply
  return b.x1+offset.x<at.x+r and b.x2+offset.x>at.x-r and b.y1+offset.y<at.y+r and b.y2+offset.y>at.y-r
 end
 local reached,queue={},{}
 for i,node in ipairs(nodes) do
  for _,source in ipairs(sources) do if covers(node,source) then node.anchor=true end end
  if node.anchor then reached[i]=true;queue[#queue+1]=i end
 end
 local cursor=1
 while queue[cursor] do
  local a=nodes[queue[cursor]];cursor=cursor+1
  for i,b in ipairs(nodes) do
   local dx,dy=a.position.x-b.position.x,a.position.y-b.position.y
   if not reached[i] and dx*dx+dy*dy<=math.min(a.wire,b.wire)^2 then reached[i]=true;queue[#queue+1]=i end
  end
 end
 local uncovered,unconnected={},{}
 local uncovered_total,unconnected_total=0,0
 for _,index in ipairs(consumers) do
  local covered,connected=false,false
  for i,node in ipairs(nodes) do if covers(node,index) then covered=true;connected=connected or reached[i] end end
  if not covered then uncovered_total=uncovered_total+1;if #uncovered<16 then uncovered[#uncovered+1]=index end
  elseif not connected then unconnected_total=unconnected_total+1;if #unconnected<16 then unconnected[#unconnected+1]=index end end
 end
 return {checked=not unknown,consumers=#consumers,existing_scan_radius=64,uncovered_total=uncovered_total,uncovered_entities=uncovered,unconnected_total=unconnected_total,unconnected_entities=unconnected,note='Bounded potential pole coverage and cable reach to an existing powered network or planned generator. Wiring, generator inputs, power headroom and production are not verified. Inspect and repair reported gaps before calling a production layout connected.'}
end
local function control_example(kind)
 if kind=='asteroid-collector' then return {['chunk-filter']={{index=1,name='oxide-asteroid-chunk'}},control_behavior={circuit_set_filters=false,circuit_read_contents=true,include_hands=true,circuit_enabled=true,circuit_condition={first_signal={type='item',name='oxide-asteroid-chunk'},comparator='<',constant=5}}} end
 if kind=='constant-combinator' then return {control_behavior={sections={sections={{index=1,filters={{index=1,type='item',name='oxide-asteroid-chunk',quality='normal',comparator='=',count=1}}}}}}} end
 if kind=='decider-combinator' then return {control_behavior={decider_conditions={conditions={{first_signal={type='item',name='oxide-asteroid-chunk'},comparator='<',constant=5}},outputs={{signal={type='virtual',name='signal-A'},copy_count_from_input=false,constant=1}},else_outputs={}}}} end
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
      local adjacent={}
      local offsets={[0]={x=0,y=-1},[4]={x=1,y=0},[8]={x=0,y=1},[12]={x=-1,y=0}}
      for i,position in ipairs(connection.connection_type=='normal' and connection.positions or {}) do
       local outward=offsets[(connection.direction+(i-1)*4)%16]
       if outward then adjacent[i]={x=position.x+outward.x,y=position.y+outward.y} end
      end
      connections[#connections+1]={fluidbox_index=box.index,production_type=box.production_type,filter=box.filter and box.filter.name,positions=connection.positions,adjacent_pipe_positions=#adjacent>0 and adjacent or nil,connection_type=connection.connection_type,flow_direction=connection.flow_direction,direction=connection.direction,alt_direction=connection.alt_direction,alt_position=connection.alt_position}
     end
    end
    local custom_vectors;if p.type=='inserter' then custom_vectors=p.allow_custom_vectors end
    local wire_distance,supply_distance;if p.type=='electric-pole' then wire_distance=p.get_max_wire_distance('normal');supply_distance=p.get_supply_area_distance('normal') end
    entities[#entities+1]={name=name,type=p.type,width=p.tile_width,height=p.tile_height,center_offset={x=(p.tile_width/2)%1,y=(p.tile_height/2)%1},supports_direction=p.supports_direction,collision_box=p.collision_box,crafting_categories=p.crafting_categories,recipe_settable=p.type=='assembling-machine',max_wire_distance=wire_distance,supply_area_distance=supply_distance,belt_items_per_second=p.belt_speed and p.belt_speed*480,mining_radius=p.mining_drill_radius,mining_speed=p.mining_speed,resource_categories=p.resource_categories,output_offset=p.vector_to_place_result,max_underground_distance=p.max_underground_distance,fluid_connections=connections,inserter_connections=inserter_connections(p),allow_custom_vectors=custom_vectors,custom_vector_max_distance=custom_inserter_range(force,p),unlocked=unlocked(available,p),blueprint_settings_example=control_example(p.type)}
   elseif prototypes.tile[name] and prototypes.tile[name].can_be_part_of_blueprint and #(prototypes.tile[name].items_to_place_this or {})>0 then
    entities[#entities+1]={name=name,type='tile',width=1,height=1,unlocked=unlocked(available,prototypes.tile[name])}
   else
    entities[#entities+1]={name=name,error='Unknown or non-blueprintable entity'}
   end
  end
  return {force=force.name,entities=entities,wire_connector_ids=defines.wire_connector_id,fluid_position_reference='Offsets from entity center. Four array entries correspond to entity directions 0,4,8,12. positions are ports inside the machine edge; adjacent_pipe_positions are the neighboring pipe centers, outside its footprint.'}
 end
 -- Native exports omit defaults, including include_hands=true in Factorio 2.1.21.
 local defaults={use_filters=false,filter_mode='whitelist',override_stack_size=0,circuit_set_filters=false,circuit_read_hand_contents=false,circuit_read_contents=false,circuit_set_stack_size=false,circuit_enabled=false,connect_to_logistic_network=false,include_hands=true,is_on=true,active=true,multiplier=1,compare_type='or',copy_count_from_input=true,quality='normal'}
 local function difference(actual,wanted,path,key)
  if actual==nil then
   actual=defaults[key]
   if key=='type' and (path:match('%.first_signal%.type$') or path:match('%.second_signal%.type$') or path:match('%.signal%.type$') or path:match('%.filters%.%d+%.type$')) then actual='item' end
   if key=='constant' and path:match('%.outputs%.%d+%.constant$') then actual=1 end
   if key=='comparator' then actual=path:match('%.filters%.%d+%.comparator$') and '=' or '<' end
  end
  if type(wanted)~='table' then return actual~=wanted and path or nil end
  if actual==nil then actual={} end
  if type(actual)~='table' then return path end
  for k,v in pairs(wanted) do local mismatch=difference(actual[k],v,path..'.'..k,k);if mismatch then return mismatch end end
 end
 local function contains(actual,wanted) return difference(actual,wanted,'','')==nil end
 local settings={'filters','use_filters','filter_mode','pickup_position','drop_position','override_stack_size','control_behavior','chunk-filter'}
 local entities,preview,boxes,warnings,collisions={},{},{},{},{}
 local warned={}
 local function warn(text) if not warned[text] then warnings[#warnings+1]=text;warned[text]=true end end
 local tiles=request.tiles or {}
 local tile_positions={}
 for _,tile in ipairs(tiles) do
  local p=prototypes.tile[tile.name]
  if not p or not p.can_be_part_of_blueprint or #(p.items_to_place_this or {})==0 then error('Unknown or non-blueprintable construction tile: '..tile.name,0) end
  local key=tile.position.x..':'..tile.position.y
  if tile_positions[key] then error('Duplicate blueprint tile',0) end
  tile_positions[key]=tile.name
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
   if p.type~='assembling-machine' then error('Entity '..i..' '..e.name..' has native type '..p.type..' and cannot accept an explicit recipe. Remove recipe from this entity; inspect recipe_settable in catalog for other machines.',0) end
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
  if (e.pickup_position or e.drop_position or e.use_filters~=nil or e.filter_mode or e.override_stack_size) and p.type~='inserter' then error('Inserter settings require an inserter',0) end
  local reach=custom_inserter_range(force,p)
  if reach then
   for _,key in ipairs({'pickup_position','drop_position'}) do
    local vector=e[key]
    if vector and (math.abs(math.floor(vector.x+0.5))>reach or math.abs(math.floor(vector.y+0.5))>reach) then
     error('Inserter '..i..' '..key..' exceeds configured Smart Inserters reach '..reach..' tiles. Route belts or move the inserter within that range.',0)
    end
   end
  end
  for _,filter in ipairs(e.filters or {}) do
   if not prototypes.item[filter.name] or (filter.quality and not prototypes.quality[filter.quality]) then error('Unknown filter item or quality',0) end
  end
  if e['chunk-filter'] then
   if p.type~='asteroid-collector' then error('chunk-filter requires an asteroid collector',0) end
   for _,filter in ipairs(e['chunk-filter']) do if not prototypes.asteroid_chunk[filter.name] then error('Unknown asteroid chunk filter',0) end end
  end
  for _,wire in ipairs(e.wires or {}) do
   if not request.entities[wire[1]] or not request.entities[wire[3]] or (wire[1]~=i and wire[3]~=i) then error('Wire endpoints must refer to this blueprint entity and another existing entity',0) end
  end
  -- Factorio omits rotation for nondirectional prototypes, including ordinary pipes and chests.
  local direction=p.supports_direction==false and 0 or e.direction
  local w,h=dimensions(p,direction)
  if (e.position.x-w/2)%1~=0 or (e.position.y-h/2)%1~=0 then error('Entity '..i..' '..e.name..' is not aligned to the tile grid: x must be integer + '..((w/2)%1)..', y must be integer + '..((h/2)%1)..' for this direction. Patch this entity position by index.',0) end
  local box={x1=e.position.x-w/2,y1=e.position.y-h/2,x2=e.position.x+w/2,y2=e.position.y+h/2}
  for j,b in ipairs(boxes) do
   if box.x1<b.x2 and box.x2>b.x1 and box.y1<b.y2 and box.y2>b.y1 then
    local other=request.entities[j]
    -- Bound diagnostics so one revision can fix several conflicts without flooding context.
    if #collisions<8 then collisions[#collisions+1]='Blueprint entities overlap: index '..i..' '..e.name..' at ('..e.position.x..', '..e.position.y..') with index '..j..' '..other.name..' at ('..other.position.x..', '..other.position.y..'). Entity '..i..' footprint ['..box.x1..', '..box.y1..'] to ['..box.x2..', '..box.y2..']; entity '..j..' footprint ['..b.x1..', '..b.y1..'] to ['..b.x2..', '..b.y2..']' end
   end
  end
  boxes[#boxes+1]=box
  entities[i]={entity_number=i,name=e.name,position=e.position,direction=direction,recipe=e.recipe,type=e.type}
  preview[i]={name=e.name,position=e.position,direction=direction,recipe=e.recipe,type=e.type,width=w,height=h}
  for _,key in ipairs(settings) do entities[i][key]=e[key];preview[i][key]=e[key] end
  local wires={}
  for _,wire in ipairs(e.wires or {}) do wires[#wires+1]=wire end
  entities[i].wires=#wires>0 and wires or nil;preview[i].wires=entities[i].wires
 end
 if #collisions>0 then error(table.concat(collisions,'; ')..'. Remove unnecessary conflicting entities by index or move them completely outside the other footprints.',0) end
 for _,wire in ipairs(request.wires or {}) do
  local source,target=entities[wire[1]],entities[wire[3]]
  if not source or not target then error('Wire endpoints must refer to existing blueprint entity indices',0) end
  source.wires=source.wires or {}
  source.wires[#source.wires+1]=wire
  preview[wire[1]].wires=source.wires
 end
 local connected={}
 for _,e in ipairs(entities) do
  for _,wire in ipairs(e.wires or {}) do connected[wire[1]]=true;connected[wire[3]]=true end
 end
 for i,e in ipairs(entities) do
  if e.control_behavior and e.control_behavior.circuit_enabled and not connected[i] then
   warn('Entity '..i..' ('..e.name..') has a circuit condition but no wire connection. Its inventory cannot control that condition until wired; encode the complete control circuit.')
  end
 end
 inventory=game.create_inventory(1)
 local stack=inventory[1]
 stack.set_stack{name='blueprint'}
 stack.set_blueprint_entities(entities,false)
 if #tiles>0 then stack.set_blueprint_tiles(tiles) end
 local normalized_tiles=stack.get_blueprint_tiles() or {}
 if #normalized_tiles~=#tiles then error('Factorio rejected blueprint tiles',0) end
 for _,tile in ipairs(normalized_tiles) do
  if tile_positions[tile.position.x..':'..tile.position.y]~=tile.name then error('Factorio changed blueprint tile positions',0) end
 end
 local normalized=stack.get_blueprint_entities() or {}
 if not normalized or #normalized~=#entities then error('Factorio rejected blueprint entities',0) end
 for i,e in ipairs(normalized) do
  for _,key in ipairs({'name','direction','recipe','type'}) do
   local actual=key=='direction' and (e.direction or 0) or e[key]
   if actual~=entities[i][key] then error('Factorio changed entity '..i..' ('..entities[i].name..') '..key..': requested '..tostring(entities[i][key])..', native '..tostring(actual)..'. Adjust that setting.',0) end
  end
  if e.position.x~=entities[i].position.x or e.position.y~=entities[i].position.y then error('Factorio changed entity '..i..' ('..e.name..') position; adjust its tile alignment',0) end
  for _,key in ipairs(settings) do
   local wanted=entities[i][key]
   local actual=e[key]
   if wanted and (key=='pickup_position' or key=='drop_position') then
    if actual then actual={x=actual.x or actual[1],y=actual.y or actual[2]}
    else
     -- Native exports omit prototype-default reach, rotated with the entity.
     for _,connection in ipairs(inserter_connections(prototypes.entity[e.name]) or {}) do
      if connection.direction==entities[i].direction then actual=key=='pickup_position' and connection.pickup_offset or connection.drop_offset;break end
     end
    end
   end
   local mismatch=wanted~=nil and difference(actual,wanted,key,key)
   if mismatch then error('Factorio changed or rejected '..mismatch..' for '..e.name..'; read blueprint_operation catalog for native settings examples',0) end
  end
 end
 local function wire_set(list)
  local result={}
  for _,entity in ipairs(list) do
   for _,w in ipairs(entity.wires or {}) do
    local a,b=w[1]..':'..w[2],w[3]..':'..w[4]
    result[a<b and a..'/'..b or b..'/'..a]=true
   end
  end
  return result
 end
 local requested_wires,native_wires=wire_set(entities),wire_set(normalized)
 if not contains(native_wires,requested_wires) or not contains(requested_wires,native_wires) then error('Factorio changed or rejected blueprint wires',0) end
 stack.label=request.label
 local cost={}
 for _,item in pairs(stack.cost_to_build) do cost[#cost+1]={name=item.name,count=item.count} end
 table.sort(cost,function(a,b)return a.name<b.name end)
 if request.operation=='create' then
  local transfers,rows={},{}
  for i,e in ipairs(entities) do
   if prototypes.entity[e.name].type=='assembling-machine' and not e.recipe then
    warn('Entity '..i..' '..e.name..' has no recipe. Set its recipe before treating this design as a working production module, or verify that an existing machine supplies the configuration for an overlay.')
   end
  end
  local undergrounds,partners={},{}
  local headings={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
  for i,e in ipairs(entities) do if prototypes.entity[e.name].type=='underground-belt' then undergrounds[#undergrounds+1]=i end end
  for _,i in ipairs(undergrounds) do
   local e=entities[i]
   local heading=headings[e.direction]
   local sign=e.type=='input' and 1 or -1
   local closest=math.huge
   for _,j in ipairs(undergrounds) do
    local other=entities[j]
    if other.name==e.name and other.direction==e.direction and other.type~=e.type then
     local dx,dy=other.position.x-e.position.x,other.position.y-e.position.y
     local distance=(heading[1]*dx+heading[2]*dy)*sign
     if heading[1]*dy-heading[2]*dx==0 and distance>0 and distance<=prototypes.entity[e.name].max_underground_distance and distance<closest then partners[i]=j;closest=distance end
    end
   end
  end
  for _,i in ipairs(undergrounds) do
   if not partners[i] or partners[partners[i]]~=i then
    warn('Underground belt entity '..i..' at ('..entities[i].position.x..', '..entities[i].position.y..') has no paired '..(entities[i].type=='input' and 'output' or 'input')..' in this design. Add its partner or verify the matching existing-world endpoint before placement.')
   end
  end
  local function target_at(position)
   for i,b in ipairs(boxes) do
    if position.x>=b.x1 and position.x<b.x2 and position.y>=b.y1 and position.y<b.y2 then return i end
   end
  end
  for i,e in ipairs(entities) do
   local p=prototypes.entity[e.name]
   if p.type=='inserter' then
    local offsets
    for _,connection in ipairs(inserter_connections(p)) do if connection.direction==e.direction then offsets=connection end end
    local function position(vector)
     return {x=e.position.x+(vector.x or vector[1]),y=e.position.y+(vector.y or vector[2])}
    end
    local pickup=position(e.pickup_position or offsets.pickup_offset)
    local drop=position(e.drop_position or offsets.drop_offset)
    local pickup_index,drop_index=target_at(pickup),target_at(drop)
    local side,capacity
    local belt=drop_index and entities[drop_index]
    if belt and prototypes.entity[belt.name].type=='transport-belt' then
     local headings={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
     local heading=headings[belt.direction]
     local lateral=heading[1]*(drop.y-belt.position.y)-heading[2]*(drop.x-belt.position.x)
     side=math.abs(lateral)<0.05 and 'center' or lateral>0 and 'right' or 'left'
     capacity=prototypes.entity[belt.name].belt_speed*240
    end
    transfers[#transfers+1]={inserter=i,pickup=pickup,drop=drop,pickup_entity=pickup_index,drop_entity=drop_index,drop_belt_side=side,belt_lane_items_per_second=capacity}
    if side then
     local last=drop_index
     local headings={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
     local heading=headings[belt.direction]
     while true do
      local at=entities[last].position
      local next_index=target_at{x=at.x+heading[1],y=at.y+heading[2]}
      local next_entity=next_index and entities[next_index]
      if not next_entity or next_index==last or prototypes.entity[next_entity.name].type~='transport-belt' or next_entity.direction~=belt.direction then break end
      last=next_index
     end
     rows[last]=rows[last] or {left=0,right=0,center=0}
     rows[last][side]=rows[last][side]+1
    end
   end
  end
  -- Trace proposed geometry only. External endpoints still need native world checks.
  local belts={}
  for i,e in ipairs(entities) do
   local kind=prototypes.entity[e.name].type
   if kind=='transport-belt' or kind=='underground-belt' then belts[e.position.x..':'..e.position.y]=i end
  end
  local function planned_path(start)
   local seen,index,length={},start,0
   while true do
    local e=entities[index];local p=prototypes.entity[e.name];local heading=headings[e.direction]
    local ending={terminal_entity=index,length=length+1,position=e.position}
    if seen[index] then ending.status='loop';ending.length=length;return ending end
    seen[index]=true;length=length+1
    if not heading or p.tile_width~=1 or p.tile_height~=1 then ending.status='unsupported';return ending end
    local next_index
    if p.type=='underground-belt' and e.type=='input' then
     next_index=partners[index]
     if not next_index or partners[next_index]~=index then ending.status='unpaired';return ending end
    else
     ending.next_position={x=e.position.x+heading[1],y=e.position.y+heading[2]}
     next_index=belts[ending.next_position.x..':'..ending.next_position.y]
     if not next_index then ending.status='external';return ending end
     local other=entities[next_index]
     if other.direction==(e.direction+8)%16 then ending.status='opposed';ending.next_entity=next_index;return ending end
     if prototypes.entity[other.name].type=='underground-belt' then
      if other.type=='output' then
       ending.status=other.direction==e.direction and 'underground_exit' or 'unsupported';ending.next_entity=next_index;return ending
      elseif other.direction~=e.direction then ending.status='unsupported';ending.next_entity=next_index;return ending end
     end
    end
    index=next_index
   end
  end
  for _,transfer in ipairs(transfers) do
   local target=transfer.drop_entity and entities[transfer.drop_entity]
   if target and belts[target.position.x..':'..target.position.y]==transfer.drop_entity then
    transfer.planned_belt_path=planned_path(transfer.drop_entity)
    local path=transfer.planned_belt_path
    if path.status=='opposed' or path.status=='underground_exit' then
     warn('Inserter '..transfer.inserter..' planned belt path cannot feed entity '..path.next_entity..' from entity '..path.terminal_entity..' ('..path.status..'). Correct this join before placement.')
    end
   end
  end
  for last,row in pairs(rows) do
   if row.center==0 and row.left+row.right>=2 and (row.left==0 or row.right==0) then
    local side=row.left>0 and 'left' or 'right'
    warn('All '..(row.left+row.right)..' planned inserters feeding the straight belt row ending at entity '..last..' use its '..side..' lane ('..(prototypes.entity[entities[last].name].belt_speed*240)..' items/s). No planned inserter feeds its other lane; check the requested output rate and existing-world feeds before placement.')
   end
  end
  -- Planned endpoints do not prove curved-belt routing or connections to the existing factory.
  return {kind='blueprint',label=request.label,blueprint=stack.export_stack(),entities=#preview>0 and preview or nil,tiles=#tiles>0 and tiles or nil,warnings=#warnings>0 and warnings or nil,cost=cost,inserter_transfers=#transfers>0 and transfers or nil}
 end
 local surface=game.surfaces[request.surface]
 if not surface then error('Unknown surface',0) end
 if surface.platform and surface.platform.force~=force then error('This platform belongs to another force',0) end
 if request.operation=='check' then
  if not prototypes.item[request.item] then error('Output measurement requires a real item prototype',0) end
  local report={operation='check_build',tick=game.tick,surface=surface.name,force=force.name,constructed=0,requested=#entities,ghosts=0,missing={},faults={},faults_total=0,machines={},machines_total=0,machine_status_counts={},terminal_belts={},terminal_belts_total=0,settings_verified=false}
  local function issue(list,row) if #list<16 then list[#list+1]=row end end
  local function status(e) for name,id in pairs(defines.entity_status) do if id==e.status then return name end end end
  for index,wanted in ipairs(entities) do
   local position={x=wanted.position.x+request.position.x,y=wanted.position.y+request.position.y}
   local found
   for _,e in pairs(surface.find_entities_filtered{position=position,name=wanted.name,force=force}) do
    if e.position.x==position.x and e.position.y==position.y then found=e;break end
   end
   if not found then
    local ghost=false
    for _,e in pairs(surface.find_entities_filtered{position=position,type='entity-ghost',force=force}) do
     if e.ghost_name==wanted.name and e.position.x==position.x and e.position.y==position.y then ghost=true;break end
    end
    if ghost then report.ghosts=report.ghosts+1 end
    issue(report.missing,{index=index,name=wanted.name,position=position,reason=ghost and 'Awaiting construction' or 'No matching entity or ghost'})
   else
    report.constructed=report.constructed+1
    local recipe=(found.type=='assembling-machine' or found.type=='furnace') and found.get_recipe()
    local mismatch=(found.prototype.supports_direction and found.direction~=wanted.direction) or (wanted.recipe and (not recipe or recipe.name~=wanted.recipe)) or (wanted.type and found.type=='underground-belt' and found.belt_to_ground_type~=wanted.type)
    if mismatch then report.faults_total=report.faults_total+1;issue(report.faults,{index=index,name=found.name,position=position,reason='Direction, recipe or underground type differs from the design',direction=found.direction,recipe=recipe and recipe.name}) end
    if found.type=='assembling-machine' or found.type=='furnace' then
     local state=status(found) or 'unknown'
     report.machines_total=report.machines_total+1
     report.machine_status_counts[state]=(report.machine_status_counts[state] or 0)+1
     issue(report.machines,{index=index,name=found.name,position=position,status=state,recipe=recipe and recipe.name,crafting=found.is_crafting(),powered=found.is_connected_to_electric_network()})
    elseif found.type=='transport-belt' and #found.belt_neighbours.outputs==0 then
     report.terminal_belts_total=report.terminal_belts_total+1
     issue(report.terminal_belts,{index=index,position=position,capacity_per_min=found.prototype.belt_speed*480*60,left_items=found.get_transport_line(1).get_item_count{name=request.item,quality='normal'},right_items=found.get_transport_line(2).get_item_count{name=request.item,quality='normal'}})
    end
   end
  end
  report.missing_total=report.requested-report.constructed
  report.rows_limited_to=16
  report.tiles_missing=0
  for _,tile in ipairs(tiles) do if surface.get_tile{x=tile.position.x+request.position.x,y=tile.position.y+request.position.y}.name~=tile.name then report.tiles_missing=report.tiles_missing+1 end end
  local outputs,seen={},{}
  for _,at in ipairs(request.outputs) do
   local found
   for _,e in pairs(surface.find_entities_filtered{position=at,force=force}) do
    if e.position.x==at.x and e.position.y==at.y and (e.type=='container' or e.type=='logistic-container' or e.type=='space-platform-hub') then
     if found then error('Ambiguous output destination',0) end
     found=e
    end
   end
   if not found or not found.unit_number then error('Output destination must be an exact built chest or platform hub in this force',0) end
   if seen[found.unit_number] then error('Duplicate output destination',0) end
   seen[found.unit_number]=true
   outputs[#outputs+1]={unit_number=found.unit_number,count=found.get_item_count{name=request.item,quality='normal'}}
  end
  if #outputs>0 then report.output_sample={tick=game.tick,item=request.item,outputs=outputs} end
  report.note='Read-only construction and operating-state check. Belt contents are occupancy, not throughput; circuit settings and input sustainability are not verified. Sample retained destination inventories twice to measure delivery.'
  return report
 end
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
 local completed_tile_items={}
 for _,tile in ipairs(tiles) do
  local position={x=tile.position.x+request.position.x,y=tile.position.y+request.position.y}
  local existing=surface.get_tile(position)
  if existing.name==tile.name then
   local item=prototypes.tile[tile.name].items_to_place_this[1]
   completed_tile_items[item.name]=(completed_tile_items[item.name] or 0)+item.count
  else
   if not surface.is_chunk_generated{x=math.floor(position.x/32),y=math.floor(position.y/32)} or not force.is_chunk_charted(surface,{x=math.floor(position.x/32),y=math.floor(position.y/32)}) then
    blocked[#blocked+1]={name=tile.name,position=position,reason='Outside explored, generated terrain'}
   elseif existing.has_tile_ghost() or not surface.can_place_entity{name='tile-ghost',inner_name=tile.name,position=position,force=force,build_check_type=defines.build_check_type.manual,forced=false} then
    blocked[#blocked+1]={name=tile.name,position=position,reason='Tile cannot be placed here or already has a construction ghost'}
   else pending_tiles[#pending_tiles+1]={name=tile.name,position=position} end
  end
 end
 for i=#cost,1,-1 do
  if completed_tile_items[cost[i].name] then
   cost[i].count=cost[i].count-completed_tile_items[cost[i].name]
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
  if not charted or not can_request_ghost(force,surface,e,position,b,request.position) then
   local row={name=e.name,position=position,reason=charted and 'Occupied, unsuitable terrain or surface restrictions' or 'Outside explored, generated terrain'}
   -- Detail the first eight blocked sites; native placement remains authoritative.
   if charted and request.operation=='inspect' and #blocked<8 then
    local area={{b.x1+request.position.x,b.y1+request.position.y},{b.x2+request.position.x,b.y2+request.position.y}}
    local tile_names={}
    for _,at in ipairs({position,{x=area[1][1]+0.001,y=area[1][2]+0.001},{x=area[2][1]-0.001,y=area[1][2]+0.001},{x=area[1][1]+0.001,y=area[2][2]-0.001},{x=area[2][1]-0.001,y=area[2][2]-0.001}}) do
     tile_names[surface.get_tile(at).name]=true
    end
    row.sampled_tiles={} for name in pairs(tile_names) do row.sampled_tiles[#row.sampled_tiles+1]=name end table.sort(row.sampled_tiles)
    row.nearby_entities={}
    local nearby=surface.find_entities_filtered{area=area,limit=16}
    row.nearby_truncated=#nearby==16
    for _,other in ipairs(nearby) do
     if other.force==force or other.force.name=='neutral' then
      row.nearby_entities[#row.nearby_entities+1]={name=other.name,type=other.type,position=other.position,unit_number=other.unit_number}
     else row.other_force_present=true end
    end
    row.note='Sampled tiles and nearby entities explain the site; they are not a collision mask or clearance proof.'
   end
   blocked[#blocked+1]=row
  end
  local existing=surface.find_entities_filtered{area={{b.x1+request.position.x,b.y1+request.position.y},{b.x2+request.position.x,b.y2+request.position.y}},type='entity-ghost'}
  if #existing>0 then blocked[#blocked+1]={name=e.name,position=position,reason='An existing construction ghost occupies this position'} end
 end
 if request.operation=='inspect' then return {ready=#blocked==0,blocked=blocked,expectedTick=game.tick,expectedDesign=request.design,surface=surface.name,position=request.position,entities=#entities,tiles=#tiles,tiles_pending=#pending_tiles,cost=cost,construction=construction_report(force,surface,entities,request.position,cost),power=power_report(force,surface,entities,request.position,boxes)} end
 if #blocked>0 then error('Placement is blocked at '..blocked[1].name..'; inspect the site again',0) end
 -- Create ghosts at exact inspected coordinates; build_blueprint centers the layout around its cursor.
 local ghosts={}
 local placed=0
 local placed_tiles=0
 local failure
 -- Request tile ghosts only; ordinary robots or the platform supply the materials.
 for _,tile in ipairs(pending_tiles) do
  local ok,err=pcall(function()
   if surface.get_tile(tile.position).has_tile_ghost() or not surface.can_place_entity{name='tile-ghost',inner_name=tile.name,position=tile.position,force=force,build_check_type=defines.build_check_type.manual,forced=false} then error('Tile site changed; inspect again',0) end
   local ghost=surface.create_entity{name='tile-ghost',inner_name=tile.name,position=tile.position,force=force,expires=false}
   if not ghost then error('Factorio refused a tile ghost',0) end
   placed_tiles=placed_tiles+1
   if actor then ghost.last_user=actor end
   script.raise_script_built{entity=ghost}
   if not ghost.valid and surface.get_tile(tile.position).name~=tile.name then error('A mod changed the tile ghost',0) end
  end)
  if not ok then failure=tostring(err):match('^[^\n]*');break end
 end
 for i,e in ipairs(entities) do
  if failure then break end
  local position={x=e.position.x+request.position.x,y=e.position.y+request.position.y}
  local ok,err=pcall(function()
   local b=boxes[i]
   if surface.count_entities_filtered{area={{b.x1+request.position.x,b.y1+request.position.y},{b.x2+request.position.x,b.y2+request.position.y}},type="entity-ghost"}>0 then error("Site changed during placement",0) end
   if not can_request_ghost(force,surface,e,position,b,request.position) then error('Site changed during placement',0) end
   local creation={name='entity-ghost',inner_name=e.name,position=position,direction=e.direction,force=force,type=e.type,expires=false}
   for _,key in ipairs(settings) do creation[key]=e[key] end
   local ghost=surface.create_entity(creation)
   ghosts[i]=ghost
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
 if not failure then
  for _,e in ipairs(entities) do
   for _,wire in ipairs(e.wires or {}) do
    local ok,err=pcall(function()
     local a,b=ghosts[wire[1]],ghosts[wire[3]]
     if not a or not b or not a.valid or not b.valid then error('Wire target changed during placement',0) end
     local source,target=a.get_wire_connector(wire[2],true),b.get_wire_connector(wire[4],true)
     if not source or not target or (not source.is_connected_to(target) and not source.connect_to(target,true)) then error('Factorio rejected a wire connector or wire reach',0) end
    end)
    if not ok then failure=tostring(err):match('^[^\n]*');break end
   end
   if failure then break end
  end
 end
 return {operation='place_blueprint',surface=surface.name,position=request.position,requested=#entities,placed=placed,requested_tiles=#pending_tiles,placed_tiles=placed_tiles,complete=placed==#entities and placed_tiles==#pending_tiles and not failure,error=failure,cost=cost,note=surface.platform and 'Construction requests use real platform hub inventory. No structures were removed.' or 'Construction ghosts require real items and player or robot construction. No structures were removed.'}
end
