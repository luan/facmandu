local engine=require('engine.init')
local plan=assert(pack.plan,'Missing native production plan')
local entities,ports,sources,sinks,inputs,steps={},{},{},{},{},{}
local arm=assert(pack.inserters[problem.tiers.inserter])
assert(math.abs(arm.pickup_position[1])<0.01 and arm.pickup_position[2]==-1 and math.abs(arm.insert_position[1])<0.01 and arm.insert_position[2]>=1 and arm.insert_position[2]<1.5,'Select a standard one-tile inserter for native plan cells')
local demand,available,requested={},{},{}
local function key(kind,name) return kind..'/'..name end
for _,port in ipairs(problem.inputs) do available[key('item',port.item)]=(available[key('item',port.item)] or 0)+port.perMinute end
for _,port in ipairs(problem.fluid_inputs or {}) do available[key('fluid',port.item)]=(available[key('fluid',port.item)] or 0)+port.perMinute end
for _,port in ipairs(problem.outputs) do requested[key(port.type or 'item',port.item)]=port end
for _,part in ipairs(plan.ingredients) do if part.type~='entity' and part.perMinute>0.000001 then
 local k=key(part.type,part.name)
 assert((available[k] or 0)+0.000001>=part.perMinute,'Insufficient native plan supply: '..part.name)
 demand[k]=part.perMinute
 inputs[#inputs+1]={item=part.name,type=part.type,perMinute=part.perMinute}
end end
local function add(name,x,y,settings)
 local e=settings or {};e.name=name;e.position={x=x,y=y};e.direction=e.direction or 0
 entities[#entities+1]=e;e.entity_number=#entities;return #entities
end
local function rate(parts,kind,name)
 for _,part in ipairs(parts) do if part.type==kind and part.name==name then return part.perMinute end end
 return 0
end
local y=2
for _,line in ipairs(plan.lines) do if line.machines>0.000001 then
 local recipe=assert(pack.recipes[line.recipe])
 local machine=assert(pack.machines[line.machine] or pack.furnaces[line.machine])
 local w,h=table.unpack(machine.native_size or machine.size)
 assert(w==h,'Native plan cells require square machines')
 local count=math.ceil(line.machines-0.000000001)
 local spacing=w+6
 local columns=math.floor((problem.area[2][1]-4)/spacing)
 assert(columns>0,'Native plan machine does not fit the block')
 local rows=math.ceil(count/columns)
 assert(y+rows*(h+5)+2<=problem.area[2][2],'Native plan exceeds the selected area; split the plan into bounded blocks')
 local production=0
 for _,part in ipairs(line.products) do if part.type~='entity' then production=production+part.perMinute end end
 steps[#steps+1]={recipe=line.recipe,machines=count,perMinute=production}
 for i=1,count do
  local x=((i-1)%columns)*spacing+3+w/2
  local top=y+math.floor((i-1)/columns)*(h+5)
  local lane=math.floor(x)+0.5
  local center=top+2+h/2
  if #recipe.ingredients>0 then
   assert(problem.logistics,'Item supplies require requester/provider tiers')
   local filters={}
   for j,part in ipairs(recipe.ingredients) do
    assert(demand[key('item',part.name)],'Internal item intermediates need a separate belt or logistics stage: '..part.name)
    filters[j]={index=j,type='item',name=part.name,quality='normal',comparator='=',count=math.max(math.ceil(part.amount*2),math.ceil(rate(line.ingredients,'item',part.name)/count/2))}
   end
   local chest=add(problem.logistics.requester,lane,top+0.5,{request_filters={sections={{index=1,filters=filters}}}})
   for _,part in ipairs(recipe.ingredients) do ports[#ports+1]={entity=chest,item=part.name,kind='input',position=entities[chest].position,perMinute=rate(line.ingredients,'item',part.name)/count} end
   add(problem.tiers.inserter,lane,top+1.5)
  end
  local settings={direction=4};if not pack.furnaces[line.machine] then settings.recipe=line.recipe end
  add(line.machine,x,center,settings)
  local item_products={}
  for _,part in ipairs(recipe.results) do if part.type=='item' then
   assert(requested[key('item',part.name)],'Internal item intermediates need a separate belt or logistics stage: '..part.name)
   item_products[#item_products+1]=part
  end end
  if #item_products>0 then
   assert(problem.logistics,'Item outputs require requester/provider tiers')
   add(problem.tiers.inserter,lane,top+h+2.5)
   local chest=add(problem.logistics.provider,lane,top+h+3.5,{bar=5})
   for _,part in ipairs(item_products) do ports[#ports+1]={entity=chest,item=part.name,kind='output',position=entities[chest].position,perMinute=rate(line.products,'item',part.name)/count} end
  end
  for _,part in ipairs(recipe.fluid_inputs) do sinks[#sinks+1]={fluid=part.name,position={x=x+part.position.x,y=center+part.position.y},direction=0} end
  for _,part in ipairs(recipe.fluid_outputs) do sources[#sources+1]={fluid=part.name,position={x=x+part.position.x,y=center+part.position.y},direction=0} end
 end
 y=y+rows*(h+5)+2
end end
for _,port in ipairs(problem.fluid_inputs or {}) do if demand[key('fluid',port.item)] then
 sources[#sources+1]={fluid=port.item,position=port.position,direction=port.direction,external=true,perMinute=demand[key('fluid',port.item)]}
end end
for _,port in ipairs(problem.outputs) do if port.type=='fluid' then sinks[#sinks+1]={fluid=port.item,position=port.position,direction=port.direction,external=true,perMinute=port.perMinute} end end
-- Join every producer to one header per fluid, rather than letting disconnected
-- producers each serve an arbitrary subset of consumers.
local headers,joins={},{}
for _,port in ipairs(sources) do
 if not headers[port.fluid] then headers[port.fluid]=port
 else joins[#joins+1]=port end
end
local roots={}
local names={} for name in pairs(headers) do names[#names+1]=name end;table.sort(names)
for _,name in ipairs(names) do roots[#roots+1]=headers[name] end
for _,port in ipairs(joins) do sinks[#sinks+1]=port end
local model,errors=engine.blueprint.load({entities=entities},pack)
assert(#errors==0,'Invalid native plan machine geometry')
local obstacles={}
for _,e in ipairs(model.entities) do for _,tile in ipairs(e.tiles) do obstacles[#obstacles+1]={x=tile[1],y=tile[2]} end end
local routed,issues=engine.fluids.solve({kind='fluid',area=problem.area,inputs=roots,outputs=sinks,obstacles=obstacles,
 tiers={pipe=problem.tiers.pipe,underground=problem.tiers.pipe_underground}},pack)
assert(routed,'Native plan fluid routing failed: '..tostring(issues and issues[1] and issues[1].message))
local pipes,blocked={},{}
for _,e in ipairs(routed.blueprint.blueprint.entities) do
 local id=add(e.name,e.position.x,e.position.y,{direction=e.direction or 0})
 local k=engine.blueprint.tile_key(math.floor(e.position.x),math.floor(e.position.y));pipes[k]=id;blocked[k]=true
end
for _,entry in ipairs{{sources,'input'},{sinks,'output'}} do for _,port in ipairs(entry[1]) do if port.external then
 ports[#ports+1]={entity=assert(pipes[engine.blueprint.tile_key(math.floor(port.position.x),math.floor(port.position.y))]),
  item=port.fluid,kind=entry[2],position=port.position,perMinute=port.perMinute}
end end end
local powered={}
for _,e in ipairs(entities) do if not pack.pipes[e.name] then powered[#powered+1]=e end end
local power=engine.power.cover(powered,pack,{area=problem.area,blocked=blocked,poles={problem.tiers.pole}})
assert(power.unpowered==0 and not power.split,'Could not power the complete native plan')
local poles,wires={},{}
for _,p in ipairs(power.poles) do poles[p.position.x..','..p.position.y]=add(p.name,p.position.x,p.position.y) end
for _,wire in ipairs(power.wires) do local a,b=wire[1],wire[2];wires[#wires+1]={assert(poles[a.x..','..a.y]),5,assert(poles[b.x..','..b.y]),5} end
assert(#entities<=1000,'Native plan needs '..#entities..' entities; split the plan to stay within 1000')
for _,e in ipairs(entities) do e.entity_number=nil end
return {entities=entities,wires=wires,inputs=inputs,steps=steps,ports=ports,warnings={
 'Native planner quantities, connected fluid headers and robot-fed external items. Live logistics coverage, ordinary robots and external power are required.'}}
