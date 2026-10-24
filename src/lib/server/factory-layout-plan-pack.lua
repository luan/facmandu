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
 local offsets={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
 local function boxes_for(crafter,kind)
  local boxes={}
  for _,box in pairs(crafter.fluidbox_prototypes or {}) do if box.production_type==kind then boxes[#boxes+1]=box end end
  table.sort(boxes,function(a,b) return a.index<b.index end)
  return boxes
 end
 local function box_for(boxes,part,index)
  local box=boxes[part.index or index]
  for _,candidate in ipairs(boxes) do if candidate.filter and candidate.filter.name==part.name then box=candidate;break end end
  return box
 end
 local function connections(box,direction)
  local result={}
  for _,connection in pairs(box.pipe_connections or {}) do
   local p=connection.connection_type=='normal' and connection.positions[direction/4+1]
   local out=offsets[((connection.direction or 0)+direction)%16]
   if p and out then result[#result+1]={position={x=(p.x or p[1])+out[1],y=(p.y or p[2])+out[2]},side=out[2]==0} end
  end
  return result
 end
 local function orientation(crafter,inputs,outputs,allow_ends)
  -- Native exports discard rotation when the recipe has no active fluidboxes.
  if #inputs==0 and #outputs==0 then return 0 end
  -- Rotate the machine, not its recipe: electrolysers expose lateral ports facing
  -- north, while foundries and chemical plants do so facing east.
  local best,score
  for _,direction in ipairs{4,0,8,12} do
   local valid,sides=true,0
   for _,entry in ipairs{{inputs,'input'},{outputs,'output'}} do
    local boxes=boxes_for(crafter,entry[2])
    for i,part in ipairs(entry[1]) do
     local box=box_for(boxes,part,i)
     local found,lateral=false,false
     for _,c in ipairs(box and connections(box,direction) or {}) do found=true;lateral=lateral or c.side end
     if not found or not lateral and not allow_ends then valid=false end
     if lateral then sides=sides+1 end
    end
   end
   if valid and (not score or sides>score) then best,score=direction,sides end
  end
  return assert(best,'No fluid orientation leaves the solid transfer lanes clear: '..crafter.name)
 end
 local function volume(box)
  local ok,value=pcall(function() return box.get_volume() end)
  return ok and value or box.volume
 end
 local function ports(crafter,parts,kind,direction,reserved)
  assert(#parts==0 or (request.tiers.pipe and request.tiers.pipe_underground),'Saved fluid stages require pipe tiers')
  assert(#parts==0 or crafter.tile_width==crafter.tile_height,'Native fluid cells require square machines: '..crafter.name)
  local boxes=boxes_for(crafter,kind)
  local result={}
  for i,part in ipairs(parts) do
   local box=assert(box_for(boxes,part,i),'Missing '..kind..' fluid port: '..crafter.name)
   assert(not box.filter or box.filter.name==part.name,'Fluid filter does not match '..part.name)
   -- A single recipe fluid can merge several native fluidboxes. Reserve every
   -- active connector, including the alternate socket we do not pipe explicitly.
   for _,candidate in ipairs(boxes) do if candidate==box or #parts==1 and (not candidate.filter or candidate.filter.name==part.name) then
    for _,c in ipairs(connections(candidate,direction)) do reserved[#reserved+1]={name=part.name,position=c.position} end
   end end
   local position
   for _,c in ipairs(connections(box,direction)) do position=c.position;if c.side then break end end
   assert(position,'Missing fluid connection: '..crafter.name)
   result[#result+1]={name=part.name,amount=part.amount,position=position,temperature=part.temperature,volume=volume(box)}
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
  local stochastic=false
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
   stochastic=stochastic or (part.probability or part.independent_probability or 1)<1 or part.amount_min~=nil
   -- Factorio supplies the same expected product amount used by the planner,
   -- including random yields and productivity. Layout never changes the plan.
   local amount
   if p.get_product_amount then amount=p.get_product_amount(i,productivity)
   else
    assert(part.amount and (part.independent_probability or part.probability or 1)==1,'Native expected product amount is unavailable: '..name)
    amount=part.amount+math.max(0,part.amount-(part.ignored_by_productivity or 0))*productivity
   end
   local product={type=part.type,name=part.name,amount=amount}
   results[#results+1]=product
   if part.type=='fluid' then fluid_out[#fluid_out+1]={name=part.name,amount=amount,index=part.fluidbox_index,temperature=part.temperature} end
  end
  if request.logistics and pack.chests[request.logistics.provider].mode=='storage' and #results>math.ceil(crafter.tile_width/2) then
   local provider=entity('active-provider-chest','logistic-container')
   assert(provider.logistic_mode=='active-provider' and provider.tile_width==1 and provider.tile_height==1,'Mixed-product collection requires a one-tile active provider chest')
   pack.chests[provider.name]={size={1,1},mode=provider.logistic_mode,capacity=provider.get_inventory_size(defines.inventory.chest)}
   pack.mixed_output_provider=provider.name
  end
  local allow_ends=#ingredients==0
  for _,part in ipairs(results) do if part.type=='item' then allow_ends=false end end
  local category
  for _,c in ipairs(recipe.categories) do if crafter.crafting_categories[c] then category=c;break end end
  local direction=orientation(crafter,fluid_in,fluid_out,allow_ends)
  local reserved={}
  local fluid_inputs=ports(crafter,fluid_in,'input',direction,reserved)
  local fluid_outputs=ports(crafter,fluid_out,'output',direction,reserved)
  local disposal
  if crafter.type=='furnace' and #ingredients==0 and #results==0 and #fluid_in==1 then
   local box=box_for(boxes_for(crafter,'input'),fluid_in[1],1)
   local capacity=volume(box)
   disposal={fluid=fluid_in[1].name,capacity=capacity,threshold=math.floor(capacity*.5),wire_reach=crafter.get_max_circuit_wire_distance()}
  end
  pack.recipes[name]={category=category,time=recipe.energy,machine=crafter.name,ingredients=ingredients,results=results,
   stochastic=stochastic,direction=direction,fluid_inputs=fluid_inputs,fluid_outputs=fluid_outputs,fluid_connections=reserved,disposal=disposal}
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
 for _,line in ipairs(solved.lines) do
  local products,index={},{}
  -- Simplex separates used products from surplus; transport must collect their combined yield.
  for _,list in ipairs{line.products,line.byproducts or {}} do for _,part in ipairs(list) do
   local k=part.type..'/'..part.name
   if index[k] then index[k].perMinute=index[k].perMinute+(part.perMinute or 0)
   else local p={name=part.name,type=part.type,perMinute=part.perMinute or 0};products[#products+1]=p;index[k]=p end
  end end
  lines[#lines+1]={recipe=line.recipe,machine=line.machine,machines=line.machines,
   productionType=line.productionType,products=products,ingredients=line.ingredients}
 end
 -- A fractional gas producer otherwise runs flat out into its disposal furnaces.
 -- Regulate fluid-only producers from the most demanded output, before venting.
 local vented,demand,drivers,consumers={},{},{},{}
 for _,recipe in pairs(pack.recipes) do if recipe.disposal then vented[recipe.disposal.fluid]=true end end
 for _,line in ipairs(lines) do if not pack.recipes[line.recipe].disposal then
  for _,part in ipairs(line.ingredients) do if part.type=='fluid' then
   demand[part.name]=(demand[part.name] or 0)+part.perMinute
   local c=consumers[part.name] or {count=0};consumers[part.name]=c
   c.count=c.count+math.ceil(line.machines-0.000000001);c.recipe=pack.recipes[line.recipe];c.machine=line.machine
  end end
 end end
 for _,part in ipairs(solved.products) do if part.type=='fluid' then demand[part.name]=(demand[part.name] or 0)+part.perMinute end end
 for _,line in ipairs(lines) do
  local recipe=pack.recipes[line.recipe]
  local solids=false;for _,part in ipairs(recipe.results) do if part.type=='item' then solids=true end end
  local incoming={};for _,part in ipairs(recipe.fluid_inputs) do incoming[part.name]=true end
  local driver,required
  -- Read the normal consumer: producer output boxes empty into the pipes, and disposal buffers cannot return their stock.
  if not solids then for _,part in ipairs(recipe.fluid_outputs) do if vented[part.name] and not incoming[part.name] and part.amount>0 and (demand[part.name] or 0)>0 then
   local rate=demand[part.name]/part.amount
   if not required or rate>required then driver,required=part,rate end
  end end end
  local consumer=driver and consumers[driver.name]
  -- One consumer buffer is an honest demand signal. Multiple consumers need independent demand signals before this can generalize.
  if consumer and consumer.count==1 then
   local input
   for _,part in ipairs(consumer.recipe.fluid_inputs) do if part.name==driver.name then input=part end end
   recipe.regulation={fluid=driver.name,threshold=math.max(1,math.floor(math.min(input.amount*2,input.volume*.5))),
    wire_reach=prototypes.entity[line.machine].get_max_circuit_wire_distance()}
   for _,output in ipairs(recipe.fluid_outputs) do
    local sink=consumers[output.name]
    if sink and sink.count==1 then
     for _,part in ipairs(sink.recipe.fluid_inputs) do if part.name==output.name then
      drivers[output.name]=math.max(1,math.floor(math.min(part.amount*2,part.volume*.5)))
     end end
     sink.recipe.sensor={wire_reach=prototypes.entity[sink.machine].get_max_circuit_wire_distance()}
    end
   end
  end
 end
 -- Gate every consumed co-product, not just the driving gas: a disposal buffer must not trap another required ingredient.
 for _,recipe in pairs(pack.recipes) do if recipe.disposal and drivers[recipe.disposal.fluid] then
  recipe.disposal.threshold=drivers[recipe.disposal.fluid]*2
  local pump=entity('pump','pump')
  assert(pump.tile_width==1 and pump.tile_height==2,'Fluid overflow gates require a one-by-two pump')
  pack.pumps=pack.pumps or {}
  pack.pumps.pump={size={1,2},wire_reach=pump.get_max_circuit_wire_distance()}
  recipe.disposal.gate='pump'
 end end
 -- Buffer entry-stage fluid co-products so their internally used solids can start the downstream factory.
 local used,buffered,external={},{},{}
 for _,part in ipairs(solved.ingredients) do external[part.type..'/'..part.name]=true end
 for _,line in ipairs(lines) do for _,part in ipairs(line.ingredients) do if part.type=='item' and part.perMinute>0.000001 then used[part.name]=true end end end
 for _,line in ipairs(lines) do if line.machines>0.000001 then local recipe=pack.recipes[line.recipe]
  local entry=true;for _,part in ipairs(line.ingredients) do if part.type~='entity' and not external[part.type..'/'..part.name] then entry=false end end
  local solid=false;for _,part in ipairs(recipe.results) do if part.type=='item' and used[part.name] then solid=true end end
  if entry and solid then for _,part in ipairs(recipe.fluid_outputs) do buffered[part.name]=true end end
 end end
 if next(buffered) then
  local tank=entity('storage-tank','storage-tank')
  local sockets={}
  for _,box in pairs(tank.fluidbox_prototypes) do for _,port in ipairs(connections(box,0)) do sockets[#sockets+1]=port.position end end
  pack.tanks={['storage-tank']={size={tank.tile_width,tank.tile_height},connections=sockets}}
  pack.buffer_fluids={};for name in pairs(buffered) do pack.buffer_fluids[#pack.buffer_fluids+1]=name end;table.sort(pack.buffer_fluids)
 end
 pack.plan={status=solved.status,lines=lines,ingredients=solved.ingredients,products=solved.products,byproducts=solved.byproducts}
end
