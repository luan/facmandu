-- Read a solved native plan; model input never supplies machine counts or geometry.
return function(request,force,surface,entity,pack,crafters,frozen_plan)
 assert(remote.interfaces['facmandu-toby-planner'],'Native plan construction requires Toby production planning')
 local actor=request.player and game.get_player(request.player) or force.players[1]
 assert(frozen_plan or (actor and actor.force==force),'Join this force once to initialize native production planning')
 assert(request.tiers.pipe and request.tiers.pipe_underground,'Native fluid plans require pipe tiers')
 local rows,temperatures={},{}
 for _,name in ipairs(request.recipes) do
  local recipe=assert(force.recipes[name],'Unknown recipe: '..name)
  assert(recipe.enabled,'Recipe is locked: '..name)
  for _,part in pairs(recipe.products) do if part.type=='fluid' then
   local temperature=part.temperature or prototypes.fluid[part.name].default_temperature
   assert(not temperatures[part.name] or temperatures[part.name]==temperature,'Mixed-temperature production needs a separate block: '..part.name)
   temperatures[part.name]=temperature
  end end
 end
 local function ports(crafter,parts,kind,allow_ends)
  assert(crafter.tile_width==crafter.tile_height,'Native fluid cells require square machines: '..crafter.name)
  local boxes={}
  for _,box in pairs(crafter.fluidbox_prototypes or {}) do if box.production_type==kind then boxes[#boxes+1]=box end end
  table.sort(boxes,function(a,b) return a.index<b.index end)
  local result={}
  local offsets={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
  for i,part in ipairs(parts) do
   local box=boxes[part.index or i]
   for _,candidate in ipairs(boxes) do if candidate.filter and candidate.filter.name==part.name then box=candidate;break end end
   assert(box,'Missing '..kind..' fluid port: '..crafter.name)
   assert(not box.filter or box.filter.name==part.name,'Fluid filter does not match '..part.name)
   local position
   for _,connection in pairs(box.pipe_connections or {}) do
    local p=connection.connection_type=='normal' and connection.positions[2]
    local out=offsets[((connection.direction or 0)+4)%16]
    if p and out and (out[2]==0 or allow_ends) then position={x=(p.x or p[1])+out[1],y=(p.y or p[2])+out[2]};break end
   end
   assert(position,'No side fluid connection fits '..crafter.name)
   result[#result+1]={name=part.name,amount=part.amount,position=position,temperature=part.temperature}
  end
  return result
 end
 for _,name in ipairs(request.recipes) do
  local recipe=force.recipes[name]
  local p=recipe.prototype
  for _,condition in pairs(p.surface_conditions or {}) do
   local value=surface.get_property(condition.property)
   assert(not (condition.min and value<condition.min or condition.max and value>condition.max),'Recipe cannot run on this surface: '..name)
  end
  local crafter
  for _,candidate in ipairs(crafters) do
   for _,category in ipairs(recipe.categories) do if candidate.crafting_categories[category] and (not candidate.fixed_recipe or candidate.fixed_recipe.name==name) then crafter=candidate;break end end
   if crafter then break end
  end
  if not crafter and request.tiers.furnace then
   local candidate=prototypes.entity[request.tiers.furnace]
   for _,category in ipairs(recipe.categories) do if candidate.crafting_categories[category] and (not candidate.fixed_recipe or candidate.fixed_recipe.name==name) then crafter=candidate;break end end
  end
  assert(crafter,'No selected machine can craft '..name)
  assert(not crafter.fixed_recipe or crafter.fixed_recipe.name==name,'Machine has a different fixed recipe: '..name)
  local ingredients,results,fluid_in,fluid_out={},{},{},{}
  local row={name=name,machine=crafter.name,quality='normal',modules={},beacon=false,temperatures={},productionType=#recipe.products==0 and 'consume' or 'produce'}
  for _,part in pairs(recipe.ingredients) do
   if part.type=='fluid' then
    local temperature=temperatures[part.name] or prototypes.fluid[part.name].default_temperature
    assert(not (part.minimum_temperature and temperature<part.minimum_temperature or part.maximum_temperature and temperature>part.maximum_temperature),'Missing temperature-compatible supply: '..part.name)
    row.temperatures[part.name]=temperature
    fluid_in[#fluid_in+1]={name=part.name,amount=part.amount,index=part.fluidbox_index}
   else ingredients[#ingredients+1]={type='item',name=part.name,amount=part.amount} end
  end
  local effect=crafter.effect_receiver and crafter.effect_receiver.base_effect
  local productivity=math.min((recipe.productivity_bonus or 0)+(effect and effect.productivity or 0),p.maximum_productivity or math.huge)
  for i,part in ipairs(recipe.products) do
   assert((part.independent_probability or part.probability or 1)==1 and part.amount,'Probabilistic recipes need a separate qualified template: '..name)
   local amount=p.get_product_amount and p.get_product_amount(i,productivity) or part.amount+math.max(0,part.amount-(part.ignored_by_productivity or 0))*productivity
   local product={type=part.type,name=part.name,amount=amount}
   results[#results+1]=product
   if part.type=='fluid' then fluid_out[#fluid_out+1]={name=part.name,amount=amount,index=part.fluidbox_index,temperature=part.temperature} end
  end
  local allow_ends=#ingredients==0
  for _,part in ipairs(results) do if part.type=='item' then allow_ends=false end end
  local category
  for _,c in ipairs(recipe.categories) do if crafter.crafting_categories[c] then category=c;break end end
  pack.recipes[name]={category=category,time=recipe.energy,machine=crafter.name,ingredients=ingredients,results=results,
   fluid_inputs=ports(crafter,fluid_in,'input',allow_ends),fluid_outputs=ports(crafter,fluid_out,'output',allow_ends)}
  rows[#rows+1]=row
 end
 local products,inputs={},{}
 for _,port in ipairs(request.outputs) do products[#products+1]={name=port.item,type=port.type or 'item',perMinute=port.perMinute,temperature=port.type=='fluid' and (temperatures[port.item] or prototypes.fluid[port.item].default_temperature) or nil} end
 for _,port in ipairs(request.inputs) do inputs[#inputs+1]={name=port.item,type=port.type or 'item',perMinute=port.perMinute,mode='maximum',temperature=port.type=='fluid' and prototypes.fluid[port.item].default_temperature or nil} end
 local solved=frozen_plan or remote.call('facmandu-toby-planner','solve',force.name,actor.name,surface.name,products,rows,inputs)
 assert(solved.status=='solved','Native production plan is '..tostring(solved.status))
 local available={}
 for _,port in ipairs(request.inputs) do available[(port.type or 'item')..'/'..port.item]=port.perMinute end
 for _,part in ipairs(solved.ingredients) do if part.type~='entity' and part.perMinute>0.000001 then
  assert((available[part.type..'/'..part.name] or 0)+0.000001>=part.perMinute,'Undeclared native plan supply: '..part.name..' '..part.perMinute..'/min')
 end end
 local requested={}
 for _,port in ipairs(request.outputs) do requested[(port.type or 'item')..'/'..port.item]=true end
 for _,part in ipairs(solved.byproducts) do if part.type~='entity' and part.perMinute>0.000001 then
  assert(requested[part.type..'/'..part.name],'Add a disposal recipe or output for '..part.name)
 end end
 local lines={}
 for _,line in ipairs(solved.lines) do lines[#lines+1]={recipe=line.recipe,machine=line.machine,machines=line.machines,
  productionType=line.productionType,products=line.products,ingredients=line.ingredients} end
 pack.plan={status=solved.status,lines=lines,ingredients=solved.ingredients,products=solved.products,byproducts=solved.byproducts}
end
