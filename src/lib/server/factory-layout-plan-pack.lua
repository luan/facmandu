-- Read a solved native plan; model input never supplies machine counts or geometry.
return function(request,force,surface,entity,pack,crafters,frozen_plan)
 assert(frozen_plan,'Layout requires a solved plan from the planner')

 local temperatures={}
 for _,port in ipairs(request.inputs) do if port.type=='fluid' and port.temperature then temperatures[port.item]=port.temperature end end
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
  assert(#parts==0 or (request.tiers.pipe and request.tiers.pipe_underground),'Saved fluid stages require pipe tiers')
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
  local selected
  for _,line in ipairs(frozen_plan.lines) do if line.recipe==name then
   assert(not selected or selected==line.machine,'Split recipe lines using different machines into separate layout blocks')
   selected=line.machine
  end end
  local crafter=selected and prototypes.entity[selected]
  assert(crafter and (pack.machines[selected] or pack.furnaces[selected]),'Saved machine is unavailable: '..tostring(selected))
  local compatible=false for _,category in ipairs(recipe.categories) do if crafter.crafting_categories[category] then compatible=true end end
  assert(compatible,'Saved machine cannot craft '..name)
  assert(crafter,'No selected machine can craft '..name)
  assert(not crafter.fixed_recipe or crafter.fixed_recipe.name==name,'Machine has a different fixed recipe: '..name)
  local ingredients,results,fluid_in,fluid_out={},{},{},{}
  for _,part in pairs(recipe.ingredients) do
   if part.type=='fluid' then
    local temperature=temperatures[part.name] or prototypes.fluid[part.name].default_temperature
    for _,line in ipairs(frozen_plan.lines) do if line.recipe==name and line.temperatures and line.temperatures[part.name] then assert(line.temperatures[part.name]==temperature,'Saved fluid temperature does not match its supply: '..part.name) end end
    assert(not (part.minimum_temperature and temperature<part.minimum_temperature or part.maximum_temperature and temperature>part.maximum_temperature),'Missing temperature-compatible supply: '..part.name)
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
 end
 local solved=frozen_plan
 for _,line in ipairs(solved.lines) do
  assert(not line.quality or line.quality=='normal','Layout does not yet support this saved quality; keep the plan unchanged')
  assert(not line.modules or #line.modules==0,'Layout does not yet support saved modules; keep the plan unchanged')
  assert(not line.beacon,'Layout does not yet support saved beacons; keep the plan unchanged')
  assert(not line.fuel,'Layout does not yet support saved burner fuel; keep the plan unchanged')
 end
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
