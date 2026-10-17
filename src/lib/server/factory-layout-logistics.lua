local engine=require('engine.init')
local recipeName,recipe=next(pack.recipes)
assert(recipe and not next(pack.recipes,recipeName),'Logistics cells require one selected recipe')
local fluid_inputs=recipe.fluid_inputs or {}
local output=problem.outputs[1]
assert(#problem.outputs==1 and recipe.results[1].name==output.item,'Select the recipe for the requested product')
local machineName=recipe.machine or problem.tiers.machine
local machine=assert(pack.machines[machineName],'Logistics cells require an electric assembler')
local arm=assert(pack.inserters[problem.tiers.inserter])
assert(math.abs(arm.pickup_position[1])<0.01 and arm.pickup_position[2]==-1 and math.abs(arm.insert_position[1])<0.01 and arm.insert_position[2]>=1 and arm.insert_position[2]<1.5,'Select a standard one-tile inserter for logistics cells')
local target=output.perMinute
local capacity=machine.crafting_speed/recipe.time*recipe.results[1].amount*60
local count=math.ceil(target/capacity-0.000000001)
local w,h=table.unpack(machine.native_size or machine.size)
machine.size=machine.native_size or machine.size
local spacing=w+(#fluid_inputs>0 and 6 or 2)
local columns=math.floor(problem.area[2][1]/spacing)
assert(columns>0 and math.ceil(count/columns)*(h+5)<=problem.area[2][2],'The requested logistics cells do not fit; enlarge the block, not reduce the target')
-- Reserve room for power poles; increase the private endpoint cap only after larger native trials.
assert(count*5<=900 and count*#recipe.ingredients<=256,'Split this logistics array into smaller blocks')
local available,demand,inputs={},{},{}
for _,port in ipairs(problem.inputs) do
 assert(not available[port.item],'Use one aggregate supply budget per logistics item')
 available[port.item]=port.perMinute
end
for _,part in ipairs(recipe.ingredients) do
 local needed=target/recipe.results[1].amount*part.amount
 assert((available[part.name] or 0)+0.000001>=needed,'Insufficient declared logistics supply: '..part.name..' needs '..needed..'/min')
 inputs[#inputs+1]={item=part.name,perMinute=needed}
 demand[part.name]=needed
end
local entities,ports={},{}
local function add(name,x,y,settings)
 local entity=settings or {};entity.name=name;entity.position={x=x,y=y};entity.direction=entity.direction or 0
 entities[#entities+1]=entity;entity.entity_number=#entities;return #entities
end
for i=1,count do
 local x=((i-1)%columns)*spacing+1+w/2
 local top=math.floor((i-1)/columns)*(h+5)
 local lane=math.floor(x)+0.5
 local filters={}
 for j,part in ipairs(recipe.ingredients) do
  -- Thirty seconds at full machine speed keeps robot deliveries ahead of crafting.
  filters[j]={index=j,type='item',name=part.name,quality='normal',comparator='=',count=math.max(math.ceil(part.amount*2),math.ceil(capacity/recipe.results[1].amount*part.amount/2))}
 end
 local supply=add(problem.logistics.requester,lane,top+0.5,{request_filters={sections={{index=1,filters=filters}}}})
 for _,part in ipairs(recipe.ingredients) do
  ports[#ports+1]={entity=supply,item=part.name,kind='input',position=entities[supply].position,perMinute=demand[part.name]/count}
 end
 add(problem.tiers.inserter,lane,top+1.5)
 add(machineName,x,top+2+h/2,{recipe=recipeName,direction=#fluid_inputs>0 and 4 or 0})
 add(problem.tiers.inserter,lane,top+h+2.5)
 local product=add(problem.logistics.provider,lane,top+h+3.5,{bar=5})
 ports[#ports+1]={entity=product,item=output.item,kind='output',position=entities[product].position,perMinute=target/count}
end
local blocked={}
if #fluid_inputs>0 then
 local model,issues=engine.blueprint.load({entities=entities},pack)
 assert(#issues==0,'Invalid native logistics machine alignment')
 local obstacles,sinks,sources={},{},{}
 for _,entity in ipairs(model.entities) do
  for _,tile in ipairs(entity.tiles) do obstacles[#obstacles+1]={x=tile[1],y=tile[2]} end
 end
 for _,entity in ipairs(entities) do
  if entity.recipe then for _,fluid in ipairs(fluid_inputs) do
   sinks[#sinks+1]={fluid=fluid.name,position={x=entity.position.x+fluid.position.x,y=entity.position.y+fluid.position.y},direction=0}
  end end
 end
 for _,fluid in ipairs(fluid_inputs) do
  local needed=target/recipe.results[1].amount*fluid.amount
  local source
  for _,port in ipairs(problem.fluid_inputs or {}) do if port.item==fluid.name then
   assert(not source,'Use one aggregate supply budget per fluid');source=port
  end end
  assert(source and source.perMinute+0.000001>=needed,'Insufficient declared fluid supply: '..fluid.name)
  sources[#sources+1]={fluid=fluid.name,position=source.position,direction=source.direction}
  inputs[#inputs+1]={item=fluid.name,type='fluid',perMinute=needed}
 end
 local routed,errors=engine.fluids.solve({kind='fluid',area=problem.area,inputs=sources,outputs=sinks,
  obstacles=obstacles,tiers={pipe=problem.tiers.pipe,underground=problem.tiers.pipe_underground}},pack)
 assert(routed,'Fluid routing failed: '..tostring(errors and errors[1] and errors[1].message))
 local pipes={}
 for _,entity in ipairs(routed.blueprint.blueprint.entities) do
  local id=add(entity.name,entity.position.x,entity.position.y,{direction=entity.direction or 0})
  local key=engine.blueprint.tile_key(math.floor(entity.position.x),math.floor(entity.position.y))
  pipes[key]=id;blocked[key]=true
 end
 for _,source in ipairs(sources) do
  local id=assert(pipes[engine.blueprint.tile_key(math.floor(source.position.x),math.floor(source.position.y))])
  local rate
  for _,input in ipairs(inputs) do if input.item==source.fluid then rate=input.perMinute end end
  ports[#ports+1]={entity=id,item=source.fluid,kind='input',position=source.position,perMinute=rate}
 end
end
local powered={}
for _,entity in ipairs(entities) do if not pack.pipes[entity.name] then powered[#powered+1]=entity end end
local power=engine.power.cover(powered,pack,{area=problem.area,blocked=blocked,poles={problem.tiers.pole}})
assert(power.unpowered==0 and not power.split,'Could not power the complete logistics array')
local poles,wires={},{}
for _,pole in ipairs(power.poles) do poles[pole.position.x..','..pole.position.y]=add(pole.name,pole.position.x,pole.position.y) end
for _,wire in ipairs(power.wires) do
 local a,b=wire[1],wire[2]
 wires[#wires+1]={assert(poles[a.x..','..a.y]),5,assert(poles[b.x..','..b.y]),5}
end
for _,entity in ipairs(entities) do entity.entity_number=nil end
return {entities=entities,wires=wires,inputs=inputs,steps={{recipe=recipeName,machines=count,perMinute=target}},ports=ports,
 warnings={'Requester filters are included. Qualification feeds each chest at its declared budget; live robot capacity and logistics coverage still require inspection.'}}
