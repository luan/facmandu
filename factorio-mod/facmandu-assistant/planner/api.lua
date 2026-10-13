-- Toby embedded Factory Planner 2.1.18 API. Solves a temporary factory with the native
-- engine, preserving the player's plans, selection and navigation history.
local Factory=require('planner.backend.data.Factory')
local District=require('planner.backend.data.District')
local FactoryItem=require('planner.backend.data.FactoryItem')
local Line=require('planner.backend.data.Line')
local function list(value,max)
 if type(value)~='table' or #value==0 or #value>max then error('Invalid planner list',0) end
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
local function rates(items)
 local rows={}
 for _,item in ipairs(items) do
  local proto=item.proto
  local row={name=proto.base_name or proto.name,type=proto.type,temperature=proto.temperature}
  if proto.type=='entity' then row.amount=item.amount;row.unit=lib.is_special_power_item(proto.name) and 'W' or 'emissions/min'
  else row.perMinute=item.amount*60 end
  rows[#rows+1]=row
 end
 return rows
end
local function unlocked_machine(force,line,machine,items)
 if not machine or not line:is_machine_compatible(machine) or not lib.availability.is_machine_available(force,machine) then return false end
 local prototype=prototypes.entity[machine.name]
 if not prototype then return false end
 for _,item in pairs(prototype.items_to_place_this or {}) do
  if items[item.name]==nil then
   items[item.name]=false
   local proto=prototyper.util.find('items',item.name,'item')
   local producers=proto and RECIPE_MAPS.produce[proto.category_id][proto.id]
   for id in pairs(producers or {}) do
    local recipe=prototyper.util.find('recipes',id)
    local native=recipe and force.recipes[recipe.name]
    if native and native.enabled then items[item.name]=true;break end
   end
  end
  if items[item.name] then return true end
 end
 return false
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
local function read_plan(force_name,player_name,id)
 local player,factory=find_plan(force_name,player_name,id)
 local count=0
 local function bounded(floor)
  for line in floor:iterator() do
   count=count+1
   if count>256 then error('Plan exceeds the agent read limit of 256 rows',0) end
   if line.class=='Floor' then bounded(line) end
  end
 end
 bounded(factory.top_floor)
 local packed=factory:pack(true)
 packed.blueprint_strings=nil
 local result={planId=factory.id,name=factory.name,reference=reference(player,factory),revision=factory.revision or 0,
  force=player.force.name,forceIndex=player.force.index,district=factory.parent.name,location=factory.parent.location_proto.name,
  status=not factory.valid and 'invalid' or factory.tick_of_solver_update and 'pending' or factory.top_floor.solver_error or 'solved',
  valid=factory.valid,products=rates(factory:as_list()),
  note='Saved native plan and predicted rates. This does not measure production or authorize construction.',
  ingredients=rates(factory.top_floor.ingredients),byproducts=rates(factory.top_floor.byproducts),factory=packed}
 -- Bound wire reads; large manual plans remain editable in the native planner.
 if #helpers.table_to_json(result)>262144 then error('Plan is too large for an agent read',0) end
 return result
end
local function calculate(force_name,player_name,surface_name,products,recipes,inputs,maximize,plan_name)
 local player=game.get_player(label(player_name))
 if not player or player.force.name~=force_name then error('Choose a player on the asking force',0) end
 local state=lib.globals.player_table(player)
 if not state then error('Factory Planner has not initialized this player',0) end
 local surface=game.surfaces[label(surface_name)]
 if not surface or (surface.platform and surface.platform.force~=player.force) then error('Choose a surface available to this force',0) end
 list(products,8);list(recipes,24)
 local limits={}
 if inputs~=nil then
  if type(inputs)~='table' or #inputs>32 then error('Expected up to 32 input constraints',0) end
  if #inputs>0 then list(inputs,32) end
  for _,input in ipairs(inputs) do
   if type(input)~='table' or type(input.perMinute)~='number' then error('Invalid input supply',0) end
   limits[#limits+1]={name=input.name,type=input.type,amount=input.perMinute/60,mode=input.mode}
  end
 end
 local location_name=surface.planet and surface.planet.name or (surface.platform and 'space-platform' or surface.name)
 local location=prototyper.util.find('locations',location_name)
 if not location then error('Factory Planner has no location for this surface',0) end
 local product_protos={}
 for i,product in ipairs(products) do
  if type(product)~='table' or (product.type~='item' and product.type~='fluid') then error('Choose an item or fluid product',0) end
  if product.perMinute and product.machineCount then error('Choose a rate or machine count, not both',0) end
  local amount=product.perMinute or product.machineCount
  if type(amount)~='number' or amount~=amount or amount<=0 or amount>1000000 then error('Choose a finite positive production rate up to 1000000/min',0) end
  product_protos[i]=prototyper.util.find('items',label(product.name),product.type)
  if not product_protos[i] then error('Product is unavailable in Factory Planner',0) end
 end
 local recipe_protos={}
 local seen={}
 for i,row in ipairs(recipes) do
  if type(row)~='table' then error('Invalid planner recipe',0) end
  local name=label(row.name)
  if seen[name] then error('List each planner recipe once',0) end
  seen[name]=true
  local native=player.force.recipes[name]
  if not native or not native.enabled then error('Choose an unlocked recipe on this force: '..name,0) end
  recipe_protos[i]=prototyper.util.find('recipes',name)
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
  -- Use this surface's actual properties, including modded conditions.
  district.location_proto={}
  for key,value in pairs(location) do district.location_proto[key]=value end
  district.location_proto.surface_properties={}
  for name in pairs(prototypes.surface_property) do district.location_proto.surface_properties[name]=surface.get_property(name) end
  factory=Factory.init(plan_name or 'Toby calculation','simplex');district:insert(factory)
  for i,product in ipairs(products) do
   local item=FactoryItem.init(product_protos[i])
   if product.machineCount then item.definition={type='machines',machine_count=product.machineCount}
   else item.definition.amount=product.perMinute/60 end
   factory:insert(item)
  end
  if not factory:set_constraints(limits,maximize) then error('Invalid planner constraints',0) end
  for i,row in ipairs(recipes) do
   local line=Line.init(recipe_protos[i]);factory.top_floor:insert(line)
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
   line:refresh_line(player)
  end
  -- Selecting only the temporary floor keeps solver cache changes out of the
  -- player's active factory. No context cache/history entries are created.
  state.context.object_id=factory.top_floor.id
  solver.update(player,factory)
  local lines={}
  for line in factory.top_floor:iterator() do
   lines[#lines+1]={recipe=line.recipe.proto.name,machine=line.machine.proto.name,quality=line.machine.quality_proto.name,machines=line.machine.amount,products=rates(line.products),ingredients=rates(line.ingredients),byproducts=rates(line.byproducts),blocker=line:get_blocker()}
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
  lib.context.set(player,factory)
  lib.gui.run_refresh(player,'all')
  if not main_dialog.is_in_focus(player) then main_dialog.toggle(player) end
  return true
end
remote.add_interface('facmandu-toby-planner',{
 read_plan=read_plan,
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
  if type(expected_revision)~='number' or expected_revision~=(factory.revision or 0) then error('Plan revision conflict; read the current plan before editing',0) end
  if type(inputs)~='table' or #inputs>32 then error('Expected up to 32 input constraints',0) end
  if #inputs>0 then list(inputs,32) end
  local limits={}
  for _,input in ipairs(inputs) do
   if type(input)~='table' or type(input.perMinute)~='number' then error('Invalid input supply',0) end
   limits[#limits+1]={name=input.name,type=input.type,amount=input.perMinute/60,mode=input.mode}
  end
  if not factory:set_constraints(limits,maximize) then error('Invalid planner constraints',0) end
  solver.update(player,factory)
  lib.gui.run_refresh(player,'all')
  return read_plan(force,player_name,id)
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
