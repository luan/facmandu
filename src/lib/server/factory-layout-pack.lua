-- Read only the requested force's current recipes and entity tiers. No stock,
-- research, player, surface or world state is changed by this adapter.
return function(request)
 local force=assert(game.forces[request.force],'Unknown force')
 local surface=assert(game.surfaces[request.surface],'Unknown surface')
 assert(not surface.platform,'Platform layouts are not yet qualified by the factory compiler')
 local pack={recipes={},machines={},belts={},undergrounds={},splitters={},inserters={},furnaces={},poles={},fuels={},drills={},resources={},pipes={}}
 local unlocked={}
 for _,recipe in pairs(force.recipes) do
  if recipe.enabled then for _,product in pairs(recipe.products) do if product.type=='item' then unlocked[product.name]=true end end end
 end
 local function size(p) return {p.tile_width,p.tile_height} end
 local function keys(set)
  local names={} for name in pairs(set or {}) do if name~='parameters' then names[#names+1]=name end end
  table.sort(names) return names
 end
 local function entity(name,kind)
  local p=assert(prototypes.entity[name],'Unknown entity: '..tostring(name))
  assert(p.type==kind,'Incompatible entity tier: '..name)
  assert(not p.has_flag('not-blueprintable'),'Entity is not blueprintable: '..name)
  local available=false
  for _,item in pairs(p.items_to_place_this or {}) do if unlocked[item.name] then available=true end end
  assert(available or force.get_entity_count(name)>0,'Entity is not unlocked: '..name)
  for _,condition in pairs(p.surface_conditions or {}) do
   local value=surface.get_property(condition.property)
   assert(not (condition.min and value<condition.min or condition.max and value>condition.max),'Entity cannot run on this surface: '..name)
  end
  return p
 end
 local tiers=request.tiers
 local machine=entity(tiers.machine,'assembling-machine')
 local crafters={}
 local function add_crafter(p)
  if pack.machines[p.name] then return end
  assert(not p.burner_prototype and p.electric_energy_source_prototype,'Factory compiler requires electric crafting machines')
  crafters[#crafters+1]=p
  pack.machines[p.name]={crafting_speed=p.get_crafting_speed(),categories=keys(p.crafting_categories),size=size(p)}
 end
 add_crafter(machine)
 for _,name in ipairs(tiers.crafters or {}) do add_crafter(entity(name,'assembling-machine')) end
 if tiers.pipe then
  local pipe=entity(tiers.pipe,'pipe')
  local underground_pipe=entity(assert(tiers.pipe_underground,'Select an underground pipe'),'pipe-to-ground')
  pack.pipes[pipe.name]={}
  local reach=0
  for _,box in pairs(underground_pipe.fluidbox_prototypes or {}) do
   for _,connection in pairs(box.pipe_connections or {}) do reach=math.max(reach,connection.max_underground_distance or 0) end
  end
  assert(reach>0,'Underground pipe reach is unavailable')
  pack.pipes[underground_pipe.name]={underground=reach}
 end
 if tiers.furnace then
  local f=entity(tiers.furnace,'furnace')
  assert(f.electric_energy_source_prototype,'Factory compiler requires electric furnaces')
  pack.furnaces[f.name]={crafting_speed=f.get_crafting_speed(),categories=keys(f.crafting_categories),size=size(f)}
 end
 local belt=entity(tiers.belt,'transport-belt')
 pack.belts[belt.name]={items_per_second=belt.belt_speed*480,speed=belt.belt_speed,size=size(belt)}
 local underground=entity(tiers.underground,'underground-belt')
 assert(underground.belt_speed==belt.belt_speed,'Belt and underground speeds must match')
 pack.undergrounds[underground.name]={max_distance=underground.max_underground_distance,speed=underground.belt_speed,size=size(underground)}
 if tiers.splitter then
  local s=entity(tiers.splitter,'splitter')
  assert(s.belt_speed==belt.belt_speed,'Belt and splitter speeds must match')
  pack.splitters[s.name]={speed=s.belt_speed,size=size(s)}
 end
 for _,name in ipairs({tiers.inserter,tiers.long_inserter}) do
  local i=entity(name,'inserter')
  assert(i.electric_energy_source_prototype,'Factory compiler requires electric inserters')
  local pickup,drop=i.inserter_pickup_position,i.inserter_drop_position
  pack.inserters[name]={pickup_position={pickup.x or pickup[1],pickup.y or pickup[2]},insert_position={drop.x or drop[1],drop.y or drop[2]},rotation_speed=i.get_inserter_rotation_speed(),extension_speed=i.get_inserter_extension_speed(),size=size(i)}
 end
 local pole=entity(tiers.pole,'electric-pole')
 pack.poles[pole.name]={size=size(pole),supply=pole.get_supply_area_distance(),reach=pole.get_max_wire_distance()}
 for _,name in ipairs(request.recipes) do
  local recipe=assert(force.recipes[name],'Unknown recipe: '..name)
  assert(recipe.enabled,'Recipe is locked: '..name)
  local p=recipe.prototype
  for _,condition in pairs(p.surface_conditions or {}) do
   local value=surface.get_property(condition.property)
   assert(not (condition.min and value<condition.min or condition.max and value>condition.max),'Recipe cannot run on this surface: '..name)
  end
  assert(#recipe.products==1,'Byproduct recipes are not yet supported by the factory compiler: '..name)
  assert(#recipe.ingredients<=4,'Recipes with more than four ingredients need an additional layout template: '..name)
  local ingredients,results,fluids={},{},{}
  for _,part in pairs(recipe.ingredients) do
   if part.type=='fluid' then
    assert(tiers.pipe and tiers.pipe_underground,'Select pipe tiers for '..name)
    local default=prototypes.fluid[part.name].default_temperature
    assert(not (part.minimum_temperature and default<part.minimum_temperature or part.maximum_temperature and default>part.maximum_temperature),'Temperature-specific fluid production needs a qualified template: '..name)
    fluids[#fluids+1]={name=part.name,amount=part.amount,index=part.fluidbox_index}
   else ingredients[#ingredients+1]={type='item',name=part.name,amount=part.amount} end
  end
  assert(#ingredients>0,'Fluid-only recipes need a qualified layout template: '..name)
  local part=recipe.products[1]
  assert(part.type=='item' and (part.probability or 1)==1 and part.amount,'Probabilistic/fluid recipes are not yet supported: '..name)
  local category,crafter
  local categories=recipe.categories
  for _,candidate in ipairs(crafters) do
   for _,c in ipairs(categories) do if candidate.crafting_categories[c] and (not candidate.fixed_recipe or candidate.fixed_recipe.name==name) then category,crafter=c,candidate;break end end
   if crafter then break end
  end
  if not crafter and tiers.furnace then
   local furnace=prototypes.entity[tiers.furnace]
   for _,c in ipairs(categories) do if furnace.crafting_categories[c] then category,crafter=c,furnace;break end end
  end
  assert(crafter,'No selected machine can craft: '..name)
  assert(not crafter.fixed_recipe or crafter.fixed_recipe.name==name,'Machine has a different fixed recipe: '..name)
  local effect=crafter.effect_receiver and crafter.effect_receiver.base_effect
  local productivity=math.min((recipe.productivity_bonus or 0)+(effect and effect.productivity or 0),p.maximum_productivity or math.huge)
  local amount=p.get_product_amount and p.get_product_amount(1,productivity) or part.amount+math.max(0,part.amount-(part.ignored_by_productivity or 0))*productivity
  results[1]={type='item',name=part.name,amount=amount}
  table.sort(ingredients,function(a,b) return a.name<b.name end)
  local fluid_inputs={}
  if #fluids>0 then
   assert(pack.machines[crafter.name] and crafter.tile_width==crafter.tile_height,'Fluid inputs require a square crafting-machine template')
   local boxes={}
   for _,box in pairs(crafter.fluidbox_prototypes or {}) do if box.production_type=='input' then boxes[#boxes+1]=box end end
   table.sort(boxes,function(a,b) return a.index<b.index end)
   for i,fluid in ipairs(fluids) do
    local box
    for _,candidate in ipairs(boxes) do if candidate.index==(fluid.index or (boxes[i] and boxes[i].index)) then box=candidate;break end end
    assert(box and (not box.filter or box.filter.name==fluid.name),'Cannot bind native fluid input: '..fluid.name)
    local adjacent
    local offsets={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
    for _,connection in pairs(box.pipe_connections or {}) do
     local p=connection.connection_type=='normal' and connection.positions[2]
     local out=offsets[((connection.direction or 0)+4)%16]
     if p and out and out[2]==0 then adjacent={x=(p.x or p[1])+out[1],y=(p.y or p[2])+out[2]};break end
    end
    assert(adjacent,'Fluid port does not fit the east-facing machine template: '..name)
    fluid_inputs[#fluid_inputs+1]={name=fluid.name,amount=fluid.amount,position=adjacent}
   end
   local model=pack.machines[crafter.name]
   model.native_size=size(crafter)
   model.size={crafter.tile_width+2,crafter.tile_height}
  end
  pack.recipes[name]={category=category,time=recipe.energy,ingredients=ingredients,results=results,fluid_inputs=fluid_inputs}
  if #(tiers.crafters or {})>0 then pack.recipes[name].machine=crafter.name end
 end
 return pack
end
