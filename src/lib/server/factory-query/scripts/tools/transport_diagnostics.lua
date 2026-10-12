-- Inspect physical routing and delivered items, without changing the world.
local target = require('scripts.tools.target')
local bounded = require('scripts.tools.bounded')
local M = {}
M.manifest = {
 inspect_transport = {
  desc = 'Inspect one built belt, inserter, collector, combinator, chest, pipe, tank or pump at exact coordinates: status, direction, item counts/contents, individual belt line counts, inserter pickup/drop targets, collector/combinator/inserter native blueprint_settings (relative pickup/drop vectors, filters and control behavior), wire connections and the first fluid storage’s connections. Optional item accepts an item or fluid name; item counts use normal quality and fluid counts use native stored amounts. Belt counts are a snapshot, not measured throughput; sample delivered items over game ticks to verify a full belt. Fluid segment amounts are shared network stock, not independent stock at every pipe. Read-only; ghosts are not built entities.',
  params = {surface='string! surface name or index',x='number! map x',y='number! map y',name='string entity prototype name',unit_number='integer unit number to disambiguate',item='string exact item or fluid prototype name to count',trace_limit='integer 1..256: trace built belts, underground pairs and splitter branches at one tick; stops at force/chart boundaries. Topology is not throughput or lane/filter reachability',trace_direction='string downstream (default) for output paths, or upstream to verify actual supply paths; node edges use outputs or inputs respectively'}
 }
}
local supported={['asteroid-collector']=true,['constant-combinator']=true,['decider-combinator']=true,['transport-belt']=true,['underground-belt']=true,splitter=true,inserter=true,container=true,['logistic-container']=true,pipe=true,['pipe-to-ground']=true,['storage-tank']=true,pump=true}
local function reference(e)
 if e and e.valid then return {name=e.name,unit_number=e.unit_number,position=e.position} end
end
local function is_belt(e)
 return e.type=='transport-belt' or e.type=='underground-belt' or e.type=='splitter'
end
local function trace_belts(start,surface,force,limit,direction)
 local edge=direction=='upstream' and 'inputs' or 'outputs'
 local entities,nodes,indices={start},{},{[start.unit_number]=1}
 local truncated=false
 local cursor=1
 while cursor<=#entities do
  local e=entities[cursor]
  local row=reference(e);row.direction=e.direction;row[edge]={}
  if e.type=='splitter' then row.filter=e.splitter_filter;row.input_priority=e.splitter_input_priority;row.output_priority=e.splitter_output_priority end
  local outputs={}
  for _,next in pairs(e.belt_neighbours[edge]) do outputs[#outputs+1]=next end
  if e.type=='underground-belt' and e.belt_to_ground_type==(direction=='upstream' and 'output' or 'input') then
   local next=e.underground_belt_neighbour
   if next then outputs[#outputs+1]=next else row.unpaired=true end
  end
  table.sort(outputs,function(a,b) return a.unit_number<b.unit_number end)
  local linked={}
  for _,next in ipairs(outputs) do
   if next.valid and is_belt(next) then
    if next.force~=force or not force.is_chunk_charted(surface,{x=math.floor(next.position.x/32),y=math.floor(next.position.y/32)}) then
     row.boundary=true
    else
     local index=indices[next.unit_number]
     if not index then
      if #entities<limit then
       entities[#entities+1]=next;index=#entities;indices[next.unit_number]=index
      else row.truncated=true;truncated=true end
     end
     if index and not linked[index] then row[edge][#row[edge]+1]=index;linked[index]=true end
    end
   end
  end
  nodes[cursor]=row;cursor=cursor+1
 end
 return {tick=game.tick,direction=direction,nodes=nodes,truncated=truncated,note='Built belt topology only. Splitter filters, lane choices, inserter transfers and measured delivery need separate inspection.'}
end
local function inspect(a)
 if a.trace_direction~=nil and a.trace_direction~='upstream' and a.trace_direction~='downstream' then error('trace_direction must be upstream or downstream',0) end
 if a.trace_limit~=nil and (type(a.trace_limit)~='number' or a.trace_limit~=math.floor(a.trace_limit) or a.trace_limit<1 or a.trace_limit>256) then error('trace_limit must be an integer from 1 to 256',0) end
 local e,miss,surface,force=target.find(a)
 if not e then return miss end
 if not supported[e.type] then return {found=false,reason='Not a supported transport entity; use inspect_machine for crafting machines'} end
 if a.trace_limit and is_belt(e) and not force.is_chunk_charted(surface,{x=math.floor(e.position.x/32),y=math.floor(e.position.y/32)}) then error('Belt trace starts outside charted force territory',0) end
 if a.item~=nil and (type(a.item)~='string' or not (prototypes.item[a.item] or prototypes.fluid[a.item])) then error('Unknown item or fluid prototype',0) end
 local status
 for name,id in pairs(defines.entity_status) do if id==e.status then status=name;break end end
 local row={found=true,force=force.name,surface=surface.name,name=e.name,type=e.type,unit_number=e.unit_number,position=e.position,direction=e.direction,status=status}
 if a.trace_limit and not is_belt(e) then row.trace_unavailable='Belt tracing requires a built belt or splitter. This entity inspection is complete; use its transport targets to find the belt.' end
 if a.item then
  if prototypes.fluid[a.item] then row.item={name=a.item,kind='fluid',count=e.get_fluid_count(a.item)}
  else row.item={name=a.item,quality='normal',count=e.get_item_count{name=a.item,quality='normal'}} end
 end
 if e.type=='inserter' or e.type=='asteroid-collector' or e.type=='constant-combinator' or e.type=='decider-combinator' then
  local inventory=game.create_inventory(1)
  local ok,settings=pcall(function()
   local stack=inventory[1];stack.set_stack{name='blueprint'}
   local mapping=stack.create_blueprint{surface=surface,force=force,area=e.bounding_box,include_entities=true}
   local entities=stack.get_blueprint_entities() or {}
   for index,entity in pairs(mapping) do
    if entity==e then
     local native=entities[index]
     local result={}
     for _,key in ipairs({'filters','use_filters','filter_mode','override_stack_size','control_behavior','pickup_position','drop_position','chunk-filter'}) do result[key]=native[key] end
     for _,key in ipairs({'pickup_position','drop_position'}) do local v=result[key];if v then result[key]={x=v.x or v[1],y=v.y or v[2]} end end
     return result
    end
   end
   error('Entity could not be captured as a blueprint',0)
  end)
  inventory.destroy()
  if not ok then error(settings,0) end
  row.blueprint_settings=settings
  row.wire_connections={}
  for id,connector in pairs(e.get_wire_connectors(false)) do
   for _,connection in pairs(connector.connections) do
    row.wire_connections[#row.wire_connections+1]={connector_id=id,target_connector_id=connection.target.wire_connector_id,target=reference(connection.target.owner)}
   end
  end
 end
 if e.type=='container' or e.type=='logistic-container' then
  local inventory=e.get_inventory(defines.inventory.chest)
  local items=inventory.get_contents()
  table.sort(items,function(a,b) if a.count~=b.count then return a.count>b.count end return a.name<b.name end)
  row.contents={total_kinds=#items,items=bounded.cut(items,12),truncated=#items>12}
 elseif e.type=='inserter' then
  row.allow_custom_vectors=e.prototype.allow_custom_vectors
  row.pickup_position=e.pickup_position;row.drop_position=e.drop_position
  row.pickup_target=reference(e.pickup_target);row.drop_target=reference(e.drop_target)
  row.connected_to_power_source=e.is_connected_to_electric_network();row.energy_j=e.energy
 elseif e.type=='asteroid-collector' or e.type=='constant-combinator' or e.type=='decider-combinator' then
  -- Native blueprint_settings above carry their complete circuit configuration.
 elseif e.type=='transport-belt' or e.type=='underground-belt' or e.type=='splitter' then
  row.total_items=e.get_item_count()
  row.belt_items_per_second=e.prototype.belt_speed*480
  row.lane_items_per_second=row.belt_items_per_second/2
  if e.type=='underground-belt' then
   row.underground_type=e.belt_to_ground_type
   row.underground_neighbour=reference(e.underground_belt_neighbour)
   row.max_underground_distance=e.prototype.max_underground_distance
  end
  row.transport_lines={}
  for index=1,e.get_max_transport_line_index() do
   local line=e.get_transport_line(index)
   local entry={index=index,total_items=line.get_item_count()}
   local contents=line.get_contents()
   entry.contents={total_kinds=#contents,items=bounded.cut(contents,12),truncated=#contents>12}
   if a.item then entry.item_count=line.get_item_count{name=a.item,quality='normal'} end
   row.transport_lines[#row.transport_lines+1]=entry
  end
  local neighbours=e.belt_neighbours
  row.inputs={};row.outputs={}
  if e.type=='transport-belt' then row.belt_shape=e.belt_shape end
  for _,entity in pairs(neighbours.inputs) do
   local input=reference(entity)
   input.direction=entity.direction
   if e.type=='transport-belt' and entity.type=='transport-belt' then
    local perpendicular=(entity.direction-e.direction)%8==4
    input.connection=perpendicular and (e.belt_shape=='straight' and 'side-loading' or 'turn') or 'inline'
    input.feeds_lanes=input.connection=='side-loading' and 1 or 2
   end
   row.inputs[#row.inputs+1]=input
  end
  for _,entity in pairs(neighbours.outputs) do row.outputs[#row.outputs+1]=reference(entity) end
  if a.trace_limit then row.belt_trace=trace_belts(e,surface,force,a.trace_limit,a.trace_direction or 'downstream') end
 else
  row.stored_fluids=e.get_fluid_contents()
  -- 2.1 exposes native entity fluid connections; 2.0 retains stored-fluid evidence only.
  local major,minor=script.active_mods.base:match('^(%d+)%.(%d+)')
  if tonumber(major)>2 or (tonumber(major)==2 and tonumber(minor)>=1) then
   -- Pipes and tanks use storage 1. Extend to every pump storage when its native count is verified.
   row.fluid_storage_index=1
   row.segment_fluid=e.get_fluid_segment_fluid(1)
   row.fluid_connections={}
   for _,c in pairs(e.get_fluid_box_pipe_connections(1) or {}) do
    row.fluid_connections[#row.fluid_connections+1]={position=c.position,target_position=c.target_position,target=reference(c.target),flow_direction=c.flow_direction}
   end
  end
 end
 return row
end
M.functions={inspect_transport=inspect}
return M
