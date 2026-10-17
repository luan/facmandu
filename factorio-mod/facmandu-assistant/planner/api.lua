-- Toby embedded Factory Planner 2.1.18 API. Solves a temporary factory with the native
-- engine, preserving the player's plans, selection and navigation history.
local Factory=require('planner.backend.data.Factory')
local District=require('planner.backend.data.District')
local FactoryItem=require('planner.backend.data.FactoryItem')
local Line=require('planner.backend.data.Line')
local Floor=require('planner.backend.data.Floor')
local Recipe=require('planner.backend.data.Recipe')
local Module=require('planner.backend.data.Module')
local Beacon=require('planner.backend.data.Beacon')
local Planning=require('planner.backend.data.Planning')
local function list(value,max,empty)
 if type(value)~='table' or (not empty and #value==0) or #value>max then error('Invalid planner list',0) end
 local count=0
 for key in pairs(value) do
  if type(key)~='number' or key%1~=0 or key<1 or key>#value then error('Invalid planner list',0) end
  count=count+1
 end
 if count~=#value then error('Invalid planner list',0) end
end
local function label(value)
 if type(value)~='string' or #value==0 or #value>200 then error('Invalid planner name',0) end
 return value
end
local function item_proto(row)
 if type(row)~='table' or (row.type~='item' and row.type~='fluid' and row.type~='entity') then error('Choose a native planner item, fluid or power',0) end
 local name=label(row.name)
 if row.temperature~=nil then
  if row.type~='fluid' or type(row.temperature)~='number' or row.temperature~=row.temperature or math.abs(row.temperature)==math.huge then error('Invalid fluid temperature',0) end
  name=lib.temperature.name_with(name,row.temperature)
 end
 local proto=prototyper.util.find('items',name,row.type)
 if not proto or (row.type=='entity' and not (proto.special and lib.is_special_power_item(proto.name))) then error('Item or temperature is unavailable in the planner',0) end
 return proto
end
local function product_prototypes(products)
 list(products,8,true)
 local protos,definitions,seen={},{},{}
 for i,product in ipairs(products) do
  local proto=item_proto(product)
  local choices=(product.perMinute~=nil and 1 or 0)+(product.machineCount~=nil and 1 or 0)+(product.watts~=nil and 1 or 0)+(product.beltCount~=nil and 1 or 0)
  if choices~=1 or (proto.type=='entity' and not product.watts) or (proto.type~='entity' and product.watts) then error('Choose one rate, power or machine count',0) end
  local amount=product.perMinute or product.machineCount or product.watts or product.beltCount
  if type(amount)~='number' or amount~=amount or amount<=0 or amount>(proto.type=='entity' and 1e12 or 1000000) then error('Choose a finite positive rate, power or count',0) end
  local key=proto.type..'/'..proto.name
  if seen[key] then error('List each product once',0) end
  local definition
  if product.beltCount~=nil then
   local supply={name=proto.name,type=proto.type,mode='maximum',
    definition={type='belts',belt=product.belt,count=product.beltCount,stack=product.beltStack or 1}}
   if not Planning.validate_inputs({supply}) then error('Invalid product belt target',0) end
   definition={type='belts',belt_count=product.beltCount,belt_stack=product.beltStack or 1,
    belt_proto=prototyper.util.find('belts',product.belt)}
  elseif product.machineCount~=nil then definition={type='machines',machine_count=product.machineCount}
  else definition={type='amount',amount=product.watts or product.perMinute/60} end
  seen[key]=true;protos[i]=proto;definitions[i]=definition
 end
 return protos,definitions
end
local function input_constraints(inputs)
 if type(inputs)~='table' or #inputs>32 then error('Expected up to 32 input constraints',0) end
 if #inputs>0 then list(inputs,32) elseif next(inputs) then error('Invalid input list',0) end
 local limits={}
 for _,input in ipairs(inputs) do
  local proto=item_proto(input)
  local choices=(input.perMinute~=nil and 1 or 0)+(input.beltCount~=nil and 1 or 0)+(input.watts~=nil and 1 or 0)
  if choices~=1 then error('Choose one input rate, power or belt count',0) end
  local limit={name=proto.name,type=proto.type,mode=input.mode}
  if input.beltCount~=nil then
   limit.definition={type='belts',belt=input.belt,count=input.beltCount,stack=input.beltStack or 1}
   limit.amount=Planning.input_amount(limit)
  elseif proto.type=='entity' then limit.amount=input.watts
  elseif input.watts~=nil then error('Power requires a planner power prototype',0)
  elseif type(input.perMinute)=='number' then limit.amount=input.perMinute/60 end
  limits[#limits+1]=limit
 end
 if not Planning.validate_inputs(limits) then error('Invalid input supply',0) end
 return limits
end
local function maximize_identity(maximize)
 if not maximize then return nil end
 local proto=item_proto(maximize)
 return {name=proto.name,type=proto.type}
end
local function rates(items)
 local rows={}
 for _,item in ipairs(items) do
  local proto=item.proto
  local row={name=proto.base_name or proto.name,type=proto.type,temperature=proto.temperature}
  if proto.type=='entity' then row.amount=item.amount;row.unit=proto.name=='custom-electric-buffer' and 'W of night load coverage'
   or lib.is_special_power_item(proto.name) and 'W' or 'emissions/min'
  else row.perMinute=item.amount*60 end
  rows[#rows+1]=row
 end
 return rows
end
local function unlocked_item(force,name,items)
 if items[name]==nil then
  items[name]=false
  local proto=prototyper.util.find('items',name,'item')
  local producers=proto and RECIPE_MAPS.produce[proto.category_id][proto.id]
  for id in pairs(producers or {}) do
   local recipe=prototyper.util.find('recipes',id)
   local native=recipe and force.recipes[recipe.name]
   if native and native.enabled then items[name]=true;break end
  end
 end
 return items[name]
end
local function unlocked_placeable(force,prototype,items)
 if not prototype then return false end
 for _,item in pairs(prototype.items_to_place_this or {}) do
  if unlocked_item(force,item.name,items) then return true end
 end
 return false
end
local function unlocked_machine(force,line,machine,items)
 return machine and line:is_machine_compatible(machine) and lib.availability.is_machine_available(force,machine)
  and unlocked_placeable(force,prototypes.entity[machine.name],items)
end
local function reference(player, factory)
 return 'toby://plan/'..player.force.index..'/'..factory.id
end
local function actor(force_name,player_name)
 local player=game.get_player(label(player_name))
 if not player or player.force.name~=force_name then error('Choose a player on this force',0) end
 local state=lib.globals.player_table(player)
 if not state then error('Planner player is unavailable',0) end
 return player,state
end
local function find_plan(force_name,player_name,id)
 local player,state=actor(force_name,player_name)
 local factory=type(id)=='number' and OBJECT_INDEX[id]
 if not factory or factory.class~='Factory' or not factory.parent or factory.parent.parent~=state.realm then
  error('Plan is missing or belongs to another force',0)
 end
 return player,factory
end
local function check_revision(factory, expected_revision)
 if not factory.valid then error('Repair this plan in the planner before editing',0) end
 if type(expected_revision)~='number' or expected_revision~=(factory.revision or 0) then
  error('Plan revision conflict; read the current plan before editing',0)
 end
end
local function module_rows(set)
 local rows={}
 for module in set:iterator() do rows[#rows+1]={name=module.proto.name,quality=module.quality_proto.name,count=module.amount} end
 return rows
end
local function line_rows(floor, rows)
 for line in floor:iterator() do
  if line.class=='Floor' then line_rows(line,rows)
  else
   rows[#rows+1]={lineId=line.id,floorId=floor.id,recipe=line.recipe.proto.name,
    productionType=line.recipe.production_type,active=line.active,machine=line.machine.proto.name,
    quality=line.machine.quality_proto.name,machines=line.machine.amount,constraint=line.machine_constraint,
    productionPercent=line.production_percent,
    productionPercentApplied=line.production_percent~=nil and line:production_solver()=='sequential' and line.machine_requirement==nil,
    powerMode=line.power_mode,neighborCount=line.neighbor_count,
    modules=module_rows(line.machine.module_set),fuel=line.machine.fuel and {name=line.machine.fuel.proto.name,temperature=line.machine.fuel.temperature},beacon=line.beacon and {
     name=line.beacon.proto.name,quality=line.beacon.quality_proto.name,count=line.beacon.amount,
     modules=module_rows(line.beacon.module_set)},temperatures=line.recipe.temperatures,
    products=rates(line.products),ingredients=rates(line.ingredients),byproducts=rates(line.byproducts)}
  end
 end
end
local function find_line(factory, id)
 local line=type(id)=='number' and OBJECT_INDEX[id]
 local parent=line and line.parent
 while parent and parent.class=='Floor' do parent=parent.parent end
 if not line or line.class~='Line' or parent~=factory then error('Choose a recipe line in this plan',0) end
 return line
end
local function find_floor(factory,id)
 local floor=type(id)=='number' and OBJECT_INDEX[id]
 local parent=floor
 while parent and parent.class=='Floor' do parent=parent.parent end
 if not floor or floor.class~='Floor' or parent~=factory then error('Choose a block in this plan',0) end
 return floor
end
local function check_rows(factory,added)
 local count=added or 0
 local function bounded(floor)
  for line in floor:iterator() do
   count=count+1
   if count>256 then error('Plan exceeds the agent read limit of 256 rows',0) end
   if line.class=='Floor' then bounded(line) end
  end
 end
 bounded(factory.top_floor)
end
local function read_plan(force_name,player_name,id)
 local player,factory=find_plan(force_name,player_name,id)
 check_rows(factory)
 local lines={};line_rows(factory.top_floor,lines)
 local blocks={}
 local function block_rows(floor)
  blocks[#blocks+1]={floorId=floor.id,parentFloorId=floor.level>1 and floor.parent.id or nil,
   planning=floor.planning,solver=floor.solver,status=floor.solver_error or 'solved',products=rates(floor.level==1 and factory:as_list() or floor.products),
   ingredients=rates(floor.ingredients),byproducts=rates(floor.byproducts)}
  for child in floor:iterator() do if child.class=='Floor' then block_rows(child) end end
 end
 block_rows(factory.top_floor)
 local packed=factory:pack(true)
 packed.blueprint_strings=nil
 local result={planId=factory.id,name=factory.name,reference=reference(player,factory),revision=factory.revision or 0,
  force=player.force.name,forceIndex=player.force.index,district=factory.parent.name,location=factory.parent.location_proto.name,
  surface=factory.parent.surface_name or factory.parent.location_proto.name,
  status=not factory.valid and 'invalid' or factory.tick_of_solver_update and 'pending' or factory.top_floor.solver_error or 'solved',
  valid=factory.valid,solver=factory.top_floor.solver,products=rates(factory:as_list()),
  note='Saved native plan and predicted rates. Production percentages cover Sequential demand; matrix solvers optimize recipe ratios. This does not measure production or authorize construction.',
  ingredients=rates(factory.top_floor.ingredients),byproducts=rates(factory.top_floor.byproducts),factory=packed,lines=lines,
  topFloorId=factory.top_floor.id,blocks=blocks}
 -- Bound wire reads; large manual plans remain editable in the native planner.
 if #helpers.table_to_json(result)>262144 then error('Plan is too large for an agent read',0) end
 return result
end
local function updated_plan(force_name,player_name,id)
 local ok,result=pcall(read_plan,force_name,player_name,id)
 if ok then return result end
 if result~='Plan is too large for an agent read' and result~='Plan exceeds the agent read limit of 256 rows' then error(result,0) end
 local player,factory=find_plan(force_name,player_name,id)
 return {planId=id,reference=reference(player,factory),revision=factory.revision or 0,
  status=factory.top_floor.solver_error or 'solved',truncated=true,
  note='The edit was applied. This plan exceeds the agent read limit; open it in the native planner.'}
end
local function quality(force, name)
 local proto=prototyper.util.find('qualities',label(name or 'normal'))
 if not proto or not force.is_quality_unlocked(proto.name) then error('Choose an unlocked quality',0) end
 return proto
end
local function modules(force, object, rows)
 if type(rows)~='table' or #rows>32 then error('Expected up to 32 module entries',0) end
 if #rows>0 then list(rows,32) elseif next(rows) then error('Invalid module list',0) end
 local selected, count, seen={},0,{}
 for _,row in ipairs(rows) do
  if type(row)~='table' or type(row.count)~='number' or row.count%1~=0 or row.count<1 then error('Choose positive whole module counts',0) end
  local proto=MODULE_NAME_MAP[label(row.name)]
  local q=quality(force,row.quality)
  local key=row.name..'/'..q.name
  if seen[key] or not proto or not object.module_set:check_compatibility(proto) or not unlocked_item(force,row.name,{}) then error('Choose unique compatible modules',0) end
  seen[key]=true;count=count+row.count
  selected[#selected+1]={proto=proto,quality=q,count=row.count}
 end
 if count>object:get_module_limit() then error('Modules exceed available slots',0) end
 local current={};for module in object.module_set:iterator() do current[#current+1]=module end
 for _,module in ipairs(current) do object.module_set:remove(module);OBJECT_INDEX[module.id]=nil end
 for _,row in ipairs(selected) do object.module_set:insert(Module.init(row.proto,row.count,row.quality)) end
 object.module_set:normalize({sort=true,effects=true})
end
local function configure_line(player,line,row)
 if row.quality then line.machine.quality_proto=quality(player.force,row.quality) end
 if row.modules~=nil then modules(player.force,line.machine,row.modules) end
 if row.fuel then
  if type(row.fuel)~='table' or not line.machine.fuel then error('Choose fuel for a burner machine',0) end
  local proto=prototyper.util.find('fuels',label(row.fuel.name),line.machine.proto.burner.combined_category)
  if not proto then error('Choose compatible fuel',0) end
  line.machine.fuel:set_proto(proto,player)
  if row.fuel.temperature~=nil then
   local found=false
   for _,temperature in ipairs(line.machine.fuel.temperature_data and line.machine.fuel.temperature_data.applicable_values or {}) do
    if temperature==row.fuel.temperature then found=true;break end
   end
   if not found then error('Choose an applicable fuel temperature',0) end
   line.machine.fuel.temperature=row.fuel.temperature
  end
 end
 if row.temperatures then
  if type(row.temperatures)~='table' then error('Invalid recipe temperatures',0) end
  local count=0
  for name,value in pairs(row.temperatures) do
   count=count+1
   local data=line.recipe.temperature_data[name]
   if count>16 or not data or type(value)~='number' or value~=value then error('Invalid recipe temperature',0) end
   local found=false;for _,temperature in ipairs(data.applicable_values) do if temperature==value then found=true;break end end
   if not found then error('Choose an applicable recipe temperature',0) end
   line.recipe.temperatures[name]=value
  end
  line.recipe:build_items()
 end
 if row.beacon~=nil then
  if row.beacon==false then line:set_beacon(nil)
  else
   local data=row.beacon
   if type(data)~='table' or type(data.count)~='number' or data.count%1~=0 or data.count<0 or data.count>1000 then error('Invalid beacon count',0) end
   local proto=prototyper.util.find('beacons',label(data.name))
   if not proto or not line:uses_beacon_effects() or not unlocked_placeable(player.force,prototypes.entity[proto.name],{}) then error('This machine cannot use that beacon',0) end
   local beacon=Beacon.init(line,proto)
   beacon.quality_proto=quality(player.force,data.quality)
   if beacon:is_mono_beacon() and data.count~=1 then error('This beacon requires a count of one',0) end
   beacon.amount=data.count
   if data.modules~=nil then modules(player.force,beacon,data.modules) end
   line:set_beacon(beacon)
  end
 end
 if row.constraint~=nil and not line:set_machine_constraint(row.constraint~=false and row.constraint or nil) then error('Invalid machine capacity',0) end
 if row.productionPercent~=nil and not line:set_production_percent(row.productionPercent~=false and row.productionPercent or nil) then error('Invalid recipe production percentage',0) end
 if row.powerMode~=nil or row.neighborCount~=nil then
  local mode,neighbors=line.power_mode,line.neighbor_count
  if row.powerMode~=nil then mode=row.powerMode end
  if row.neighborCount~=nil then neighbors=row.neighborCount end
  if not line:set_power_configuration(mode~=false and mode or nil,neighbors~=false and neighbors or nil) then error('Invalid power planning configuration',0) end
 end
 if row.productionType~=nil then
  if row.productionType~='produce' and row.productionType~='consume' then error('Invalid recipe direction',0) end
  line.recipe.production_type=row.productionType
 end
 if row.active~=nil then
  if type(row.active)~='boolean' then error('Invalid active state',0) end
  line.active=row.active
 end
 line.machine:summarize_effects()
 line:refresh_line(player)
end
-- Discard replaced or rejected object graphs without retaining them in the GUI index.
local function line_object_ids(line)
 local ids={}
 local function collect(object)
  ids[object.id]=true
  if object.class=='ModuleSet' then for child in object:iterator() do collect(child) end end
  for _,name in ipairs{'recipe','machine','beacon','fuel','module_set'} do if object[name] then collect(object[name]) end end
 end
 collect(line)
 return ids
end
local function edit_line(force_name,player_name,id,expected_revision,line_id,patch)
 local player,factory=find_plan(force_name,player_name,id)
 check_revision(factory,expected_revision)
 local line=find_line(factory,line_id)
 if type(patch)~='table' then error('Invalid recipe line edit',0) end
 local allowed={recipe=true,machine=true,quality=true,modules=true,beacon=true,fuel=true,constraint=true,temperatures=true,productionType=true,productionPercent=true,powerMode=true,neighborCount=true,active=true}
 for key in pairs(patch) do if not allowed[key] then error('Unknown recipe line field: '..tostring(key),0) end end
 local first_id=storage.planner.next_object_ID
 local staged
 local ok,message=pcall(function()
  staged=Line.unpack(line:pack(false));staged.parent=line.parent
  if not staged:validate(player) then error('Repair this line in the planner before editing',0) end
  if patch.recipe then
   local name=label(patch.recipe)
   local native=player.force.recipes[name]
   local proto=prototyper.util.find('recipes',name)
   if not proto or (not proto.custom and (not native or not native.enabled)) then error('Choose an unlocked recipe',0) end
   staged.recipe=Recipe.init(staged,proto,line.recipe.production_type)
   staged.recipe:apply_temperature_defaults(player)
  end
  local machine=patch.machine and prototyper.util.find('machines',label(patch.machine),staged.recipe.proto.combined_category) or staged.machine.proto
  if not unlocked_machine(player.force,staged,machine,{}) then error('Choose an unlocked compatible machine',0) end
  staged:change_machine_to_proto(player,machine)
  configure_line(player,staged,patch)
  local compatibility=staged:get_surface_compatibility()
  if not compatibility.recipe or not compatibility.machine then error('Recipe or machine is incompatible with this plan location',0) end
 end)
 if not ok then
  for object_id=first_id,storage.planner.next_object_ID-1 do OBJECT_INDEX[object_id]=nil end
  error(message,0)
 end
 for object_id in pairs(line_object_ids(line)) do OBJECT_INDEX[object_id]=nil end
 -- Preserve the line ID and list links used by shared plan references.
 line.recipe=staged.recipe;line.recipe.parent=line
 line.machine=staged.machine;line.machine.parent=line
 line.beacon=staged.beacon;if line.beacon then line.beacon.parent=line end
 line.machine_constraint=staged.machine_constraint;line.active=staged.active
 line.production_percent=staged.production_percent
 line.power_mode,line.neighbor_count=staged.power_mode,staged.neighbor_count
 line.surface_compatibility=nil
 line.machine:summarize_effects()
 local retained=line_object_ids(line)
 for object_id=first_id,storage.planner.next_object_ID-1 do if not retained[object_id] then OBJECT_INDEX[object_id]=nil end end
 line:index()
 solver.update(player,factory)
 lib.gui.run_refresh(player,'all')
 return updated_plan(force_name,player_name,id)
end
local function calculate(force_name,player_name,surface_name,products,recipes,inputs,maximize,plan_name)
 local player=game.get_player(label(player_name))
 if not player or player.force.name~=force_name then error('Choose a player on the asking force',0) end
 local state=lib.globals.player_table(player)
 if not state then error('Factory Planner has not initialized this player',0) end
 local surface=game.surfaces[label(surface_name)]
 if not surface or (surface.platform and surface.platform.force~=player.force) then error('Choose a surface available to this force',0) end
 list(products,8,true);list(recipes,24)
 local limits=input_constraints(inputs or {})
 maximize=maximize_identity(maximize)
 local location_name=surface.planet and surface.planet.name or (surface.platform and 'space-platform' or surface.name)
 local location=prototyper.util.find('locations',location_name)
 if not location then error('Factory Planner has no location for this surface',0) end
 local product_protos,definitions=product_prototypes(products)
 local recipe_protos={}
 local seen={}
 for i,row in ipairs(recipes) do
  if type(row)~='table' then error('Invalid planner recipe',0) end
  local name=label(row.name)
  if seen[name] then error('List each planner recipe once',0) end
  seen[name]=true
  local native=player.force.recipes[name]
  recipe_protos[i]=prototyper.util.find('recipes',name)
  if not (recipe_protos[i] and recipe_protos[i].custom) and (not native or not native.enabled) then error('Choose an unlocked recipe on this force: '..name,0) end
  if not recipe_protos[i] then error('Recipe is unavailable in Factory Planner: '..name,0) end
  if row.machine then label(row.machine) end
 end
 local first_id=storage.planner.next_object_ID
 -- Match native ghost placement: a machine must have an item produced by an
 -- enabled recipe. Planner visibility alone includes future machines.
 local items={}
 local selected=state.context.object_id
 local factory, district
 local ok,result=pcall(function()
  district=District.init(plan_name or 'Toby calculation')
  district.surface_name=surface.name
  -- Use this surface's actual properties, including modded conditions.
  district.location_proto={}
  for key,value in pairs(location) do district.location_proto[key]=value end
  district.location_proto.surface_properties={}
  for name in pairs(prototypes.surface_property) do district.location_proto.surface_properties[name]=surface.get_property(name) end
  factory=Factory.init(plan_name or 'Toby calculation','simplex');district:insert(factory)
  for i,product in ipairs(products) do
   local item=FactoryItem.init(product_protos[i])
   item.definition=definitions[i]
   factory:insert(item)
  end
  if not factory:set_constraints(limits,maximize) then error('Invalid planner constraints',0) end
  for i,row in ipairs(recipes) do
   local line=Line.init(recipe_protos[i]);factory.top_floor:insert(line)
   line.recipe:apply_temperature_defaults(player)
   if row.machine then
    local machine=prototyper.util.find('machines',row.machine,line.recipe.proto.combined_category)
    if not unlocked_machine(player.force,line,machine,items) then error('Choose an unlocked compatible machine for '..row.name,0) end
    line:change_machine_to_proto(player,machine)
   else
    local found=line:change_machine_to_default(player)
    if not found or not unlocked_machine(player.force,line,line.machine.proto,items) then
     local available
     for _,machine in ipairs(prototyper.util.find('machines',nil,line.recipe.proto.combined_category).members) do
      if unlocked_machine(player.force,line,machine,items) then available=machine end
     end
     if not available then error('No unlocked compatible machine for '..row.name,0) end
     line:change_machine_to_proto(player,available)
    end
   end
   if not player.force.is_quality_unlocked(line.machine.quality_proto.name) then line.machine.quality_proto=defaults.get_fallback('qualities').proto end
   configure_line(player,line,row)
  end
  -- Selecting only the temporary floor keeps solver cache changes out of the
  -- player's active factory. No context cache/history entries are created.
  state.context.object_id=factory.top_floor.id
  solver.update(player,factory)
  local lines={}
  for line in factory.top_floor:iterator() do
   lines[#lines+1]={lineId=line.id,floorId=line.parent.id,constraint=line.machine_constraint,recipe=line.recipe.proto.name,machine=line.machine.proto.name,quality=line.machine.quality_proto.name,machines=line.machine.amount,products=rates(line.products),ingredients=rates(line.ingredients),byproducts=rates(line.byproducts),blocker=line:get_blocker()}
  end
  return {planner='toby',status=factory.top_floor.solver_error or 'solved',solver='simplex',solverError=factory.top_floor.solver_error,surface=surface.name,force=force_name,player=player.name,products=rates(factory:as_list()),ingredients=rates(factory.top_floor.ingredients),byproducts=rates(factory.top_floor.byproducts),lines=lines,note='Native solver prediction. External inputs and power must be connected; this does not measure or build a factory.'}
 end)
 state.context.object_id=selected
 if ok and plan_name then
  state.realm:insert(district)
  result.planId=factory.id
  result.reference=reference(player,factory)
  result.revision=factory.revision or 0
  lib.gui.run_refresh(player,'all')
  return result
 end
 if factory and factory.blueprints_inventory.valid then factory.blueprints_inventory.destroy() end
 for id=first_id,storage.planner.next_object_ID-1 do OBJECT_INDEX[id]=nil end
 if not ok then error(result,0) end
 return result
end
local function open_plan(force_name,player_name,id)
  local player,factory=find_plan(force_name,player_name,id)
  local assistant=player.gui.screen['facmandu-toby-panel']
  if assistant then assistant.visible=false end
  lib.context.set(player,factory)
  lib.gui.run_refresh(player,'all')
  if not main_dialog.is_in_focus(player) then main_dialog.toggle(player) end
  return true
end
remote.add_interface('facmandu-toby-planner',{
 read_plan=read_plan,
 plan_status=function(force,player_name,id)
  local _,factory=find_plan(force,player_name,id)
  return {revision=factory.revision or 0,valid=factory.valid,
   status=not factory.valid and 'invalid' or factory.tick_of_solver_update and 'pending' or factory.top_floor.solver_error or 'solved'}
 end,
 edit_line=edit_line,
 set_solver=function(force,player_name,id,expected_revision,floor_id,name,recursive)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  local floor=find_floor(factory,floor_id)
  if name~='sequential' and name~='simplex' and name~='gaussian' then error('Choose a native planner solver',0) end
  if recursive~=nil and type(recursive)~='boolean' then error('Invalid recursive solver choice',0) end
  if name~='simplex' and (floor.planning or Planning.has_constraints(floor)
    or floor.level==1 and (factory.maximize_product or #(factory.inputs or {})>0)) then
   error('Supplies, operating limits and independent block goals require Simplex',0)
  end
  floor:set_solver(name,recursive)
  factory:clear_solver_cache()
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 edit_block=function(force,player_name,id,expected_revision,floor_id,settings)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  local floor=find_floor(factory,floor_id)
  if floor.level==1 then error('Use factory inputs and products for the top block',0) end
  local planning
  if settings~=false then
   if type(settings)~='table' then error('Invalid block settings',0) end
   local allowed={linked=true,mode=true,inputs=true,products=true,maximize=true}
   for key in pairs(settings) do if not allowed[key] then error('Unknown block setting: '..tostring(key),0) end end
   list(settings.products,32,true)
   local products={}
   for _,row in ipairs(settings.products) do
    local proto=item_proto(row)
    local choices=(row.perMinute~=nil and 1 or 0)+(row.watts~=nil and 1 or 0)+(row.beltCount~=nil and 1 or 0)
    if choices~=1 or row.machineCount~=nil or (proto.type=='entity' and row.watts==nil)
     or (proto.type~='entity' and row.watts~=nil) then error('Choose one block output rate, power or belt count',0) end
    local amount=proto.type=='entity' and row.watts or type(row.perMinute)=='number' and row.perMinute/60
    local product={name=proto.name,type=proto.type,amount=amount,mode=row.mode}
    if row.beltCount~=nil then
     if row.perMinute~=nil or row.watts~=nil then error('Choose one block output rate or belt count',0) end
     product.definition={type='belts',belt=row.belt,count=row.beltCount,stack=row.beltStack or 1}
     product.amount=Planning.input_amount(product)
    end
    products[#products+1]=product
   end
   planning={linked=settings.linked,mode=settings.mode,inputs=input_constraints(settings.inputs),
    products=products,maximize_product=maximize_identity(settings.maximize)}
  end
  if not floor:set_planning(planning) then error('Invalid block targets or supply',0) end
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 add_line=function(force,player_name,id,expected_revision,floor_id,row)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  check_rows(factory,1)
  local floor=find_floor(factory,floor_id)
  if type(row)~='table' then error('Invalid recipe line',0) end
  local proto=prototyper.util.find('recipes',label(row.name))
  local native=proto and player.force.recipes[proto.name]
  if not proto or (not proto.custom and (not native or not native.enabled)) then error('Choose an unlocked recipe',0) end
  local first_id=storage.planner.next_object_ID
  local staged
  local ok,message=pcall(function()
   staged=Line.init(proto);staged.parent=floor
   staged.recipe:apply_temperature_defaults(player)
   if row.machine then
    local machine=prototyper.util.find('machines',label(row.machine),proto.combined_category)
    if not unlocked_machine(player.force,staged,machine,{}) then error('Choose an unlocked compatible machine',0) end
    staged:change_machine_to_proto(player,machine)
   elseif not staged:change_machine_to_default(player) or not unlocked_machine(player.force,staged,staged.machine.proto,{}) then
    error('Choose an unlocked compatible machine',0)
   end
   configure_line(player,staged,row)
   local compatibility=staged:get_surface_compatibility()
   if not compatibility.recipe or not compatibility.machine then error('Recipe or machine is incompatible with this plan location',0) end
  end)
  if not ok then
   for object_id=first_id,storage.planner.next_object_ID-1 do OBJECT_INDEX[object_id]=nil end
   error(message,0)
  end
  floor:insert(staged)
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 move_line=function(force,player_name,id,expected_revision,line_id,floor_id,after_id)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  local line=find_line(factory,line_id)
  local source=line.parent
  local floor=find_floor(factory,floor_id)
  if source.level>1 and (line==source.first or source:count()==1) then error('Keep the defining recipe in its block',0) end
  local after=after_id and OBJECT_INDEX[after_id] or floor:find_last()
  if after and (after.parent~=floor or after==line) then error('Choose another row in the destination block',0) end
  if not floor:check_product_compatibility(line) then error('Recipe is unrelated to the destination block',0) end
  if source==floor then floor:move(line,after,'next')
  else source:remove(line);floor:insert(line,after,'next') end
  line:refresh_line(player)
  factory:clear_solver_cache()
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 remove_line=function(force,player_name,id,expected_revision,line_id)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  local line=find_line(factory,line_id)
  if line.parent.level>1 and line==line.parent.first then error('Keep the defining recipe in its block',0) end
  local discarded=line_object_ids(line);discarded[line.id]=true
  line.parent:remove(line)
  for object_id in pairs(discarded) do OBJECT_INDEX[object_id]=nil end
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 list_plans=function(force,player_name)
  local player,state=actor(force,player_name)
  local plans={}
  for district in state.realm:iterator() do
   for factory in district:iterator() do
    if #plans==50 then return {plans=plans,truncated=true} end
    plans[#plans+1]={planId=factory.id,name=factory.name,district=district.name,reference=reference(player,factory),revision=factory.revision or 0}
   end
  end
  return {plans=plans,truncated=false}
 end,
 set_inputs=function(force,player_name,id,expected_revision,inputs,maximize)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  local limits=input_constraints(inputs)
  if not factory:set_constraints(limits,maximize_identity(maximize)) then error('Invalid planner constraints',0) end
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 nest_line=function(force,player_name,id,expected_revision,line_id)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  check_rows(factory,1)
  local line=find_line(factory,line_id)
  -- Limit automated nesting depth; larger native trees remain manually editable.
  if line.parent.level>=16 then error('Plan exceeds the automated nesting depth of 16',0) end
  if line.parent.level>1 and line==line.parent.first then error('Keep the defining recipe in its block',0) end
  Floor.create_subfloor(line)
  factory:clear_solver_cache()
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 set_products=function(force,player_name,id,expected_revision,products)
  local player,factory=find_plan(force,player_name,id)
  check_revision(factory,expected_revision)
  local protos,definitions=product_prototypes(products)
  local maximize=factory.maximize_product
  local retained=false
  for _,proto in ipairs(protos) do if maximize and maximize.name==proto.name and maximize.type==proto.type then retained=true end end
  local previous=factory:as_list()
  for _,product in ipairs(previous) do factory:remove(product);OBJECT_INDEX[product.id]=nil end
  for i,proto in ipairs(protos) do
   local product=FactoryItem.init(proto)
   product.definition=definitions[i]
   factory:insert(product)
  end
  factory.maximize_product=retained and maximize or nil
  factory:clear_solver_cache()
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return updated_plan(force,player_name,id)
 end,
 solve=function(force,player,surface,products,recipes,inputs,maximize)
  return calculate(force,player,surface,products,recipes,inputs,maximize)
 end,
 create_plan=function(force,player_name,surface,name,products,recipes,inputs,maximize,request_key)
  local player,state=actor(force,player_name)
  local fingerprint
  if request_key~=nil then
   label(request_key)
   fingerprint=helpers.table_to_json({surface=surface,name=name,products=products,recipes=recipes,inputs=inputs,maximize=maximize})
   local requests=state.realm.creation_requests or {}
   local saved=requests[request_key]
   if saved then
    if saved.fingerprint~=fingerprint then error('Plan request key was reused with different inputs',0) end
    local _,factory=find_plan(force,player_name,saved.result.planId)
    local result=lib.flib.deep_copy(saved.result)
    result.reference=reference(player,factory)
    result.force=player.force.name;result.player=player.name
    result.replayed=true
    result.currentRevision=factory.revision or 0
    if result.currentRevision~=result.revision then
     result.note='This creation request already succeeded. Read the shared plan reference to use its current settings and rates.'
    end
    return result
   end
  end
  local result=calculate(force,player_name,surface,products,recipes,inputs,maximize,label(name))
  if request_key then
   state.realm.creation_requests=state.realm.creation_requests or {}
   state.realm.creation_requests[request_key]={fingerprint=fingerprint,result=lib.flib.deep_copy(result)}
  end
  return result
 end,
 open_plan=open_plan,
 edit_inputs=function(force,player_name,id)
  open_plan(force,player_name,id)
  lib.gui.open_dialog(game.get_player(player_name),{dialog="supply"})
  return true
 end,
 open=function(index)
  local player=game.get_player(index)
  if not player or not lib.globals.player_table(player) then error('Planner player is unavailable',0) end
  main_dialog.toggle(player)
  return true
 end,
 export_current_factory=function(index)
  return remote.call('toby-planner-interface','export_current_factory',index)
 end
})
