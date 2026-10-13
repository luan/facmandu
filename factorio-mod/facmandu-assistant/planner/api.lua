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
 for _,item in pairs(prototype.items_to_place_this or {}) do if items[item.name] then return true end end
 return false
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
 for _,recipe in pairs(player.force.recipes) do
  if recipe.enabled then for _,product in pairs(recipe.products) do if product.type=='item' then items[product.name]=true end end end
 end
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
  lib.gui.run_refresh(player,'all')
  return result
 end
 if factory and factory.blueprints_inventory.valid then factory.blueprints_inventory.destroy() end
 for id=first_id,storage.planner.next_object_ID-1 do OBJECT_INDEX[id]=nil end
 if not ok then error(result,0) end
 return result
end
local function open_plan(force_name,player_name,id)
  local player=game.get_player(label(player_name))
  if not player or player.force.name~=force_name then error('Choose a player on this force',0) end
  local state=lib.globals.player_table(player)
  local factory=type(id)=='number' and OBJECT_INDEX[id]
  if not state or not factory or factory.class~='Factory' or not factory.parent or factory.parent.parent~=state.realm then error('Plan is missing or belongs to another player',0) end
  lib.context.set(player,factory)
  lib.gui.run_refresh(player,'all')
  if not main_dialog.is_in_focus(player) then main_dialog.toggle(player) end
  return true
end
remote.add_interface('facmandu-toby-planner',{
 solve=function(force,player,surface,products,recipes,inputs,maximize)
  return calculate(force,player,surface,products,recipes,inputs,maximize)
 end,
 create_plan=function(force,player,surface,name,products,recipes,inputs,maximize)
  return calculate(force,player,surface,products,recipes,inputs,maximize,label(name))
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
