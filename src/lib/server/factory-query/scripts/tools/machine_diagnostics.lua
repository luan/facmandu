-- One crafting machine's current state and its stored ingredients and products.
local target = require("scripts.tools.target")
local bounded = require("scripts.tools.bounded")
local transport = require("scripts.tools.transport_diagnostics")

local M = {}
M.manifest = {
  inspect_machine = {
    desc = "Inspect one built crafting machine or mining drill at exact map coordinates: actual status, inputs/outputs, modules, power and native connections. Crafting machines include recipe, progress, fluids, pipe targets and up to eight attached inserters/loaders with sixteen-node belt traces. Drills include their real mining target, bounded charted resource coverage, native drop target and downstream belt trace. Read these before separate surrounding-entity surveys. The attached scan covers the footprint plus three tiles, so remote custom inserters may be omitted. Base mining speed does not include modules/effects; coverage and stored items do not prove delivered throughput. If ambiguous, use a returned unit_number.",
    tier = "2",
    params = {
      surface = "string! surface name or index", x = "number! map x", y = "number! map y",
      connections = "boolean default true; false skips attached transport reads",
      name = "string entity prototype name to disambiguate", unit_number = "integer entity unit number to disambiguate",
    },
  },
}

local CRAFTERS = { ["assembling-machine"] = true, furnace = true, ["rocket-silo"] = true }
local INPUT = {
  ["assembling-machine"] = defines.inventory.crafter_input or defines.inventory.assembling_machine_input,
  furnace = defines.inventory.crafter_input or defines.inventory.furnace_source,
  ["rocket-silo"] = defines.inventory.crafter_input or defines.inventory.rocket_silo_input,
}
local function items(inventory)
  if not inventory or not inventory.valid then return nil end
  local rows = inventory.get_contents()
  table.sort(rows, function(a, b)
    if a.count ~= b.count then return a.count > b.count end
    return a.name < b.name
  end)
  return { total_kinds = #rows, shown = math.min(#rows, 12), items = bounded.cut(rows, 12) }
end
local function status_name(value)
  for name, id in pairs(defines.entity_status) do
    if id == value then return name end
  end
  return tostring(value)
end
local function inspect_machine(a)
  if a.connections~=nil and type(a.connections)~='boolean' then error('connections must be boolean',0) end
  local entity, miss, surface, force = target.find(a)
  if not entity then return miss end
  if entity.type=='mining-drill' then
    local mined=entity.mining_target
    local p=mined and mined.valid and force.is_chunk_charted(surface,{x=math.floor(mined.position.x/32),y=math.floor(mined.position.y/32)}) and mined.prototype
    local mining=p and p.mineable_properties
    local row={found=true,force=force.name,surface=surface.name,name=entity.name,type=entity.type,
      unit_number=entity.unit_number,x=entity.position.x,y=entity.position.y,
      status=status_name(entity.status),active=entity.active,energy_j=bounded.round(entity.energy,0),
      electric_network_id=entity.electric_network_id,connected_to_power_source=entity.is_connected_to_electric_network(),
      modules=items(entity.get_module_inventory()),fuel=items(entity.get_fuel_inventory()),
      mining_area=entity.mining_area,base_mining_speed=entity.prototype.mining_speed,
      force_mining_productivity_bonus=force.mining_drill_productivity_bonus,
      mining_target=p and {name=mined.name,position=mined.position,amount=mined.amount,
        category=p.resource_category,mining=mining and {mining_time=mining.mining_time,products=mining.products,
          required_fluid=mining.required_fluid,fluid_amount=mining.fluid_amount} or nil} or nil,
      drop_position=entity.drop_position}
    -- Coverage is bounded and charted; overlapping drills must not sum it as independent reserves.
    local resources=surface.find_entities_filtered{area=entity.mining_area,type='resource',force='neutral',limit=2048}
    local coverage={};local shown=0
    for _,e in ipairs(resources) do
      if force.is_chunk_charted(surface,{x=math.floor(e.position.x/32),y=math.floor(e.position.y/32)}) then
        local entry=coverage[e.name] or {name=e.name,tiles=0,amount=0,compatible=entity.prototype.resource_categories[e.prototype.resource_category]~=nil}
        entry.tiles=entry.tiles+1;entry.amount=entry.amount+e.amount;coverage[e.name]=entry;shown=shown+1
      end
    end
    local rows={};for _,entry in pairs(coverage) do rows[#rows+1]=entry end
    table.sort(rows,function(x,y) return x.name<y.name end)
    row.resources={scanned=#resources,charted_tiles=shown,truncated=#resources==2048,items=rows,
      note='Charted tiles within this drill area; neighboring drills can overlap these reserves. Base speed is not measured extraction.'}
    local drop=entity.drop_target
    if drop and drop.valid and drop.force==force and force.is_chunk_charted(surface,{x=math.floor(drop.position.x/32),y=math.floor(drop.position.y/32)}) then
      row.drop_target={name=drop.name,unit_number=drop.unit_number,position=drop.position}
      if a.connections~=false then
        local ok,value=pcall(transport.functions.inspect_transport,{force=force.name,surface=surface.name,x=drop.position.x,y=drop.position.y,name=drop.name,unit_number=drop.unit_number,trace_limit=16})
        row.output_transport=ok and value or nil;row.output_transport_error=not ok and tostring(value):match('^[^\n]*') or nil
      end
    end
    return row
  end
  if not CRAFTERS[entity.type] then
    return { found = false, force = force.name, surface = surface.name,
      name = entity.name, reason = "entity is not a crafting machine or mining drill" }
  end
  local recipe = entity.get_recipe()
  local row = {
    found = true, force = force.name, surface = surface.name,
    name = entity.name, type = entity.type, unit_number = entity.unit_number,
    x = entity.position.x, y = entity.position.y,
    status = entity.status and status_name(entity.status) or nil,
    active = entity.active, crafting = entity.is_crafting(),
    crafting_progress = bounded.round(entity.crafting_progress, 3),
    crafting_speed = bounded.round(entity.crafting_speed, 2),
    energy_j = bounded.round(entity.energy, 0),
    electric_network_id = entity.electric_network_id,
    connected_to_power_source = entity.is_connected_to_electric_network(),
    input = items(entity.get_inventory(INPUT[entity.type])),
    output = items(entity.get_output_inventory()),
    modules = items(entity.get_module_inventory()),
  }
  if recipe then
    row.recipe = { name = recipe.name, ingredients = recipe.ingredients, products = recipe.products }
  end
  local fluids = entity.get_fluid_contents()
  local fluid_rows = {}
  for name, amount in pairs(fluids) do fluid_rows[#fluid_rows + 1] = { name = name, amount = bounded.round(amount, 2) } end
  table.sort(fluid_rows, function(x, y) return x.name < y.name end)
  row.fluids = { total_kinds = #fluid_rows, fluids = bounded.cut(fluid_rows, 12) }
  -- 2.1 exposes recipe-specific fluid storages directly; 2.0 needs its legacy fluidbox adapter.
  local major,minor=(script.active_mods.base or ''):match('^(%d+)%.(%d+)')
  if tonumber(major) and (tonumber(major)>2 or (tonumber(major)==2 and tonumber(minor)>=1)) then
    local ports={}
    for index=1,math.min(entity.fluids_count,32) do
      local filter=entity.get_fluid_filter(index)
      local filter_value=filter and {name=filter.fluid and filter.fluid.name,minimum_temperature=filter.minimum_temperature,maximum_temperature=filter.maximum_temperature} or nil
      for _,connection in ipairs(entity.get_fluid_box_pipe_connections(index) or {}) do
        local target=connection.target
        ports[#ports+1]={fluid_storage_index=index,filter=filter_value,flow_direction=connection.flow_direction,connection_type=connection.connection_type,port_position=connection.position,pipe_position=connection.target_position,connected_to=target and target.valid and {name=target.name,unit_number=target.unit_number,position=target.position} or nil}
      end
    end
    row.fluid_ports={total=#ports,shown=math.min(#ports,32),truncated=#ports>32,connections=bounded.cut(ports,32),position_reference='World coordinates. pipe_position is the intended neighboring pipe center; connected_to is the actual connection, if any.'}
  end
  if a.connections~=false then
    local b=entity.bounding_box
    local area={{b.left_top.x-3,b.left_top.y-3},{b.right_bottom.x+3,b.right_bottom.y+3}}
    local candidates=surface.find_entities_filtered{area=area,force=force,type={'inserter','loader','loader-1x1'},limit=64}
    local attached={}
    for _,e in ipairs(candidates) do
      local input,output
      if e.type=='inserter' then input=e.drop_target==entity;output=e.pickup_target==entity
      else input=e.loader_container==entity and e.loader_type=='input';output=e.loader_container==entity and e.loader_type=='output' end
      if input or output then attached[#attached+1]={entity=e,role=input and 'input' or 'output'} end
    end
    table.sort(attached,function(x,y) return x.entity.unit_number<y.entity.unit_number end)
    local connections={}
    for _,entry in ipairs(bounded.cut(attached,8)) do
      local e=entry.entity
      local ok,details=pcall(transport.functions.inspect_transport,{force=force.name,surface=surface.name,x=e.position.x,y=e.position.y,name=e.name,unit_number=e.unit_number,trace_limit=16,trace_direction=entry.role=='input' and 'upstream' or 'downstream'})
      local connection={role=entry.role,transport=ok and details or nil,error=not ok and tostring(details):match('^[^\n]*') or nil}
      if e.type=='inserter' then
        local endpoint=entry.role=='input' and e.pickup_target or e.drop_target
        if endpoint and endpoint.valid and (endpoint.type=='transport-belt' or endpoint.type=='underground-belt' or endpoint.type=='splitter' or endpoint.type=='loader' or endpoint.type=='loader-1x1') then
          local traced,value=pcall(transport.functions.inspect_transport,{force=force.name,surface=surface.name,x=endpoint.position.x,y=endpoint.position.y,name=endpoint.name,unit_number=endpoint.unit_number,trace_limit=16,trace_direction=entry.role=='input' and 'upstream' or 'downstream'})
          connection.belt=traced and value or nil;connection.belt_error=not traced and tostring(value):match('^[^\n]*') or nil
        end
      end
      connections[#connections+1]=connection
    end
    row.connections={items=connections,total=#attached,shown=#connections,truncated=#candidates==64 or #attached>8,scan_area=area,note='Actual native targets, not proximity. Custom inserters outside this area are not scanned; belt traces show topology, not delivered rates.'}
  end
  return row
end
M.functions = { inspect_machine = inspect_machine }
return M
