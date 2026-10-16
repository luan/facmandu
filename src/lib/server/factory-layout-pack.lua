-- Read only the requested force's current recipes and entity tiers. No stock,
-- research, player, surface or world state is changed by this adapter.
return function(request)
 local force=assert(game.forces[request.force],'Unknown force')
 local surface=assert(game.surfaces[request.surface],'Unknown surface')
 assert(not surface.platform,'Platform layouts are not yet qualified by the factory compiler')
 local pack={recipes={},machines={},belts={},undergrounds={},splitters={},inserters={},furnaces={},poles={},fuels={},drills={},resources={}}
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
 assert(not machine.burner_prototype and machine.electric_energy_source_prototype,'Factory compiler requires electric crafting machines')
 pack.machines[machine.name]={crafting_speed=machine.get_crafting_speed(),categories=keys(machine.crafting_categories),size=size(machine)}
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
  local ingredients,results={},{}
  for _,part in pairs(recipe.ingredients) do
   assert(part.type=='item','Fluid production is not yet supported by the factory compiler: '..name)
   ingredients[#ingredients+1]={type='item',name=part.name,amount=part.amount}
  end
  local part=recipe.products[1]
  assert(part.type=='item' and (part.probability or 1)==1 and part.amount,'Probabilistic/fluid recipes are not yet supported: '..name)
  local category,crafter
  local categories=recipe.categories
  for _,c in ipairs(categories) do if machine.crafting_categories[c] then category,crafter=c,machine;break end end
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
  pack.recipes[name]={category=category,time=recipe.energy,ingredients=ingredients,results=results}
 end
 return pack
end
