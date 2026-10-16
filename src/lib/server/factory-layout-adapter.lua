local engine = require('engine.init')
local fraction = engine.fraction
local directions={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
for _,output in ipairs(problem.outputs) do
 local capacity=pack.belts[problem.tiers.belt].items_per_second
 if output.rate>capacity then error('Output target exceeds the selected belt capacity',0) end
 if output.rate>capacity/2 then
  local left=directions[(output.direction+12)%16]
  local x,y=output.position.x+left[1],output.position.y+left[2]
  if x<0 or y<0 or x>=problem.area[2][1] or y>=problem.area[2][2] then error('Full-belt output needs a side-loading tile inside the block; move the port away from the corner',0) end
 end
end
-- Full-belt targets must reach qualification; measured delivery is the gate.
engine.rows.MAX_LANE_USE=fraction.new(1)
if #(problem.fluid_inputs or {})>0 then
 -- Moving-belt output needs two arms before a plant saturates a lane.
 engine.rows.INSERTER_EFFICIENCY=fraction.new(3,5)
end
local solved, errors = engine.solve(problem, pack)
if not solved then
 local messages = {}
 for _,issue in ipairs(errors) do messages[#messages+1]=issue.code..': '..issue.message..' ('..(issue.hint or '')..')' end
 error(table.concat(messages,'; '),0)
end
if solved.scale then error('Compiler cannot meet the requested rate in this area; target was not reduced',0) end
if not solved.report.ok then error('Compiler connectivity validation failed',0) end
if not solved.power or solved.power.unpowered>0 or solved.power.split then error('Compiler could not power the complete factory block',0) end
local function number(value) return fraction.is(value) and value.n/value.d or value end
local inputs, steps, ports = {}, {}, {}
for _,row in ipairs(solved.plan.inputs) do
 local needed=number(row.rate)*60
 local available=0
 for _,port in ipairs(problem.inputs) do if port.item==row.item then available=available+port.perMinute end end
 if needed>available+0.00001 then error('Insufficient declared supply: '..row.item..' needs '..needed..'/min, available '..available..'/min',0) end
 inputs[#inputs+1]={item=row.item,perMinute=needed}
end
local by_recipe={}
for _,row in ipairs(solved.plan.steps) do
 if not by_recipe[row.recipe] then
  local count=0
  for _,placed in ipairs(solved.layout.rows) do if placed.recipe==row.recipe then count=count+placed.machines end end
  local step={recipe=row.recipe,machines=count,perMinute=0}
  by_recipe[row.recipe]=step;steps[#steps+1]=step
 end
 local step=by_recipe[row.recipe];step.perMinute=step.perMinute+number(row.rate)*60
end
local entities, wires={},{ }
for _,step in ipairs(solved.plan.steps) do
 if #(pack.recipes[step.recipe].fluid_inputs or {})>0 and #(problem.fluid_inputs or {})==0 then error('Declare the recipe fluid supply before compiling',0) end
end
for _,entity in ipairs(solved.blueprint.blueprint.entities) do
 local port=entity.name==engine.blueprint.INPUT_PORT or entity.name==engine.blueprint.OUTPUT_PORT
 local row={name=port and problem.tiers.belt or entity.name,position=entity.position,direction=entity.direction or 0,recipe=entity.recipe,type=entity.type}
 if pack.machines[row.name] and pack.machines[row.name].native_size then row.direction=4 end
 if pack.furnaces[row.name] then row.recipe=nil end
 entities[#entities+1]=row
 if port then ports[#ports+1]={entity=#entities,item=entity.tags.interpose_item,kind=entity.name==engine.blueprint.INPUT_PORT and 'input' or 'output',position=entity.position} end
end
local power=solved.power
if #(problem.fluid_inputs or {})>0 then
 local fluid_ports,demands,supplies={},{},{}
 for _,port in ipairs(problem.fluid_inputs) do
  supplies[port.item]=(supplies[port.item] or 0)+port.perMinute
  fluid_ports[#fluid_ports+1]={fluid=port.item,position=port.position,direction=port.direction}
 end
 local sinks={}
 for _,step in ipairs(solved.plan.steps) do
  local recipe=pack.recipes[step.recipe]
  for _,fluid in ipairs(recipe.fluid_inputs or {}) do
   demands[fluid.name]=(demands[fluid.name] or 0)+number(step.rate)/recipe.results[1].amount*fluid.amount*60
  end
 end
 local names={} for name in pairs(demands) do names[#names+1]=name end;table.sort(names)
 for _,name in ipairs(names) do
  local needed=demands[name]
  if needed>(supplies[name] or 0)+0.00001 then error('Insufficient declared fluid supply: '..name..' needs '..needed..'/min',0) end
  inputs[#inputs+1]={item=name,type='fluid',perMinute=needed}
 end
 for name in pairs(supplies) do if not demands[name] then error('Unused fluid input: '..name,0) end end
 for _,model in pairs(pack.machines) do if model.native_size then model.size=model.native_size end end
 -- Pipe routes own the side corridors; add a fresh power network after piping.
 local solid={}
 for _,entity in ipairs(entities) do if not pack.poles[entity.name] then solid[#solid+1]=entity end end
 local remapped={}
 for i,entity in ipairs(solid) do
  entity.entity_number=i
  remapped[entity.position.x..','..entity.position.y]=i
  local recipe=entity.recipe and pack.recipes[entity.recipe]
  for _,fluid in ipairs(recipe and recipe.fluid_inputs or {}) do
   sinks[#sinks+1]={fluid=fluid.name,position={x=entity.position.x+fluid.position.x,y=entity.position.y+fluid.position.y},direction=0}
  end
 end
 for _,port in ipairs(ports) do port.entity=assert(remapped[port.position.x..','..port.position.y]) end
 entities=solid
 local model,issues=engine.blueprint.load({entities=entities},pack)
 if #issues>0 then error('Native fluid machine alignment failed: '..issues[1].message,0) end
 local grid,collisions=require('engine.validate.placement').check(model,{area=problem.area})
 if #collisions>0 then error('Native fluid layout overlaps: '..collisions[1].message,0) end
 for _,port in ipairs(ports) do
  local endpoint=model.by_id[port.entity]
  endpoint.kind=port.kind..'_port';endpoint.item=port.item
 end
 local disconnected=require('engine.validate.flow').check(model,pack,grid)
 if #disconnected>0 then error('Native item connections failed: '..disconnected[1].message,0) end
 local obstacles={}
 for _,entity in ipairs(model.entities) do for _,tile in ipairs(entity.tiles) do obstacles[#obstacles+1]={x=tile[1],y=tile[2]} end end
 for _,list in ipairs({fluid_ports,sinks}) do for _,port in ipairs(list) do
  local x,y=math.floor(port.position.x),math.floor(port.position.y)
  if x<0 or y<0 or x>=problem.area[2][1] or y>=problem.area[2][2] or grid[engine.blueprint.tile_key(x,y)] then error('Fluid port conflicts with the factory footprint',0) end
 end end
 local routed,failures=engine.fluids.solve({kind='fluid',area=problem.area,inputs=fluid_ports,outputs=sinks,obstacles=obstacles,tiers={pipe=problem.tiers.pipe,underground=problem.tiers.pipe_underground}},pack)
 if not routed then error('Fluid routing failed: '..failures[1].message,0) end
 local blocked={}
 local pipes={}
 for _,entity in ipairs(routed.blueprint.blueprint.entities) do
  entities[#entities+1]={name=entity.name,position=entity.position,direction=entity.direction or 0}
  local key=engine.blueprint.tile_key(math.floor(entity.position.x),math.floor(entity.position.y))
  pipes[key]=#entities;blocked[key]=true
 end
 for _,port in ipairs(problem.fluid_inputs) do
  ports[#ports+1]={entity=assert(pipes[engine.blueprint.tile_key(math.floor(port.position.x),math.floor(port.position.y))]),item=port.item,kind='input',position=port.position}
 end
 local powered={}
 for _,entity in ipairs(entities) do if not pack.pipes[entity.name] then powered[#powered+1]=entity end end
 power=engine.power.cover(powered,pack,{area=problem.area,blocked=blocked,poles={problem.tiers.pole}})
 if power.unpowered>0 or power.split then error('Could not power the piped factory block',0) end
end
for _,entity in ipairs(entities) do entity.entity_number=nil end
for _,pole in ipairs(power.poles) do entities[#entities+1]={name=pole.name,position=pole.position} end
local poles={}
for i,e in ipairs(entities) do if pack.poles[e.name] then poles[e.position.x..','..e.position.y]=i end end
for _,wire in ipairs(power.wires) do
 local a,b=wire[1],wire[2]
 local from,to=poles[a.x..','..a.y],poles[b.x..','..b.y]
 if not from or not to then error('Compiler returned an incomplete power connection',0) end
 wires[#wires+1]={from,5,to,5}
end
return {entities=entities,wires=wires,inputs=inputs,steps=steps,ports=ports,warnings=solved.warnings or {}}
