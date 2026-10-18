local engine=require('engine.init')
local plan=assert(pack.plan,'Missing native production plan')
local entities,ports,sources,sinks,inputs,steps={},{},{},{},{},{}
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
if problem.logistics then
local y=2
for _,line in ipairs(plan.lines) do if line.machines>0.000001 then
 local recipe=assert(pack.recipes[line.recipe])
 local machine=assert(pack.machines[line.machine] or pack.furnaces[line.machine])
 local w,h=table.unpack(machine.native_size or machine.size)
 assert(w==h,'Native plan cells require square machines')
 local count=math.ceil(line.machines-0.000000001)
 local cell=options.cell(w,h,problem,pack,#(recipe.fluid_inputs or {})+#(recipe.fluid_outputs or {})>0)
 local columns=options.columns(count,cell.width,cell.height,problem.area[2][1]-4,problem.area[2][2]-y-2,problem.layout.shape)
 local rows=math.ceil(count/columns)
 local production=0
 for _,part in ipairs(line.products) do if part.type~='entity' then production=production+part.perMinute end end
 steps[#steps+1]={recipe=line.recipe,machines=count,perMinute=production}
 for i=1,count do
  local left=((i-1)%columns)*cell.width
  local top=y+math.floor((i-1)/columns)*cell.height
  local x=left+cell.machine.x
  local center=top+cell.machine.y
  if #recipe.ingredients>0 then
   assert(problem.logistics,'Item supplies require requester/provider tiers')
   local filters={}
   for j,part in ipairs(recipe.ingredients) do
    assert(demand[key('item',part.name)],'Internal item intermediates need a separate belt or logistics stage: '..part.name)
    filters[j]={index=j,type='item',name=part.name,quality='normal',comparator='=',count=math.max(math.ceil(part.amount*2),math.ceil(rate(line.ingredients,'item',part.name)/count*problem.logistics.requestSeconds/60))}
   end
   local chest=add(problem.logistics.requester,left+cell.input_chest.x,top+cell.input_chest.y,{request_filters={sections={{index=1,filters=filters}}}})
   for _,part in ipairs(recipe.ingredients) do ports[#ports+1]={entity=chest,item=part.name,kind='input',position=entities[chest].position,perMinute=rate(line.ingredients,'item',part.name)/count} end
   add(problem.tiers.inserter,left+cell.input_arm.x,top+cell.input_arm.y,{pickup_position=cell.input_settings.pickup_position,drop_position=cell.input_settings.drop_position})
  end
  local settings={direction=recipe.direction or 4};if not pack.furnaces[line.machine] then settings.recipe=line.recipe end
  add(line.machine,x,center,settings)
  local item_products={}
  for _,part in ipairs(recipe.results) do if part.type=='item' then
   assert(requested[key('item',part.name)],'Internal item intermediates need a separate belt or logistics stage: '..part.name)
   item_products[#item_products+1]=part
  end end
  if #item_products>0 then
   assert(problem.logistics,'Item outputs require requester/provider tiers')
   assert(#item_products==1 or pack.chests[problem.logistics.provider].mode~='storage','Filtered storage cells need one item product')
   add(problem.tiers.inserter,left+cell.output_arm.x,top+cell.output_arm.y,{pickup_position=cell.output_settings.pickup_position,drop_position=cell.output_settings.drop_position})
   local chest=add(problem.logistics.provider,left+cell.output_chest.x,top+cell.output_chest.y,options.product_settings(problem,pack,item_products[1].name))
   for _,part in ipairs(item_products) do ports[#ports+1]={entity=chest,item=part.name,kind='output',position=entities[chest].position,perMinute=rate(line.products,'item',part.name)/count} end
  end
  for _,part in ipairs(recipe.fluid_inputs or {}) do sinks[#sinks+1]={fluid=part.name,position={x=x+part.position.x,y=center+part.position.y},direction=0} end
  for _,part in ipairs(recipe.fluid_outputs or {}) do sources[#sources+1]={fluid=part.name,position={x=x+part.position.x,y=center+part.position.y},direction=0} end
 end
 y=y+rows*cell.height+2
end end
else
 local placed=beltPlan()
 entities,ports,sources,sinks,steps=placed.entities,placed.ports,placed.sources,placed.sinks,placed.steps
end
for _,port in ipairs(problem.fluid_inputs or {}) do if demand[key('fluid',port.item)] then
 local d=({[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}})[port.direction]
 sources[#sources+1]={fluid=port.item,position=port.position,direction=port.direction,external=true,perMinute=demand[key('fluid',port.item)],access={x=math.floor(port.position.x)+d[1],y=math.floor(port.position.y)+d[2]}}
end end
for _,port in ipairs(problem.outputs) do if port.type=='fluid' then local d=({[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}})[port.direction];sinks[#sinks+1]={fluid=port.item,position=port.position,direction=port.direction,external=true,perMinute=port.perMinute,access={x=math.floor(port.position.x)-d[1],y=math.floor(port.position.y)-d[2]}} end end
-- Join every producer to one header per fluid, rather than letting disconnected
-- producers each serve an arbitrary subset of consumers.
local priority={}
if not problem.logistics then local n=0;for _,p in ipairs(sinks) do if not priority[p.fluid] then n=n+1;priority[p.fluid]=n end end end
local headers,joins={},{}
for _,port in ipairs(sources) do
 if not headers[port.fluid] then headers[port.fluid]=port
 else joins[#joins+1]=port end
end
local roots={}
local names={} for name in pairs(headers) do names[#names+1]=name end;table.sort(names)
for _,name in ipairs(names) do roots[#roots+1]=headers[name] end
for _,port in ipairs(joins) do sinks[#sinks+1]={fluid=port.fluid,position=port.position,direction=port.direction,access=port.access} end
local model,errors=engine.blueprint.load({entities=entities},pack)
assert(#errors==0,'Invalid native plan machine geometry')
local obstacles={}
for _,e in ipairs(model.entities) do for _,tile in ipairs(e.tiles) do obstacles[#obstacles+1]={x=tile[1],y=tile[2]} end end
local reserved={}
for _,e in ipairs(entities) do
 local recipe=e.recipe and pack.recipes[e.recipe]
 if not recipe and pack.furnaces[e.name] then for _,line in ipairs(plan.lines) do if line.machine==e.name then recipe=pack.recipes[line.recipe];break end end end
 for _,p in ipairs(recipe and recipe.fluid_connections or {}) do reserved[#reserved+1]={fluid=p.name,x=math.floor(e.position.x+p.position.x),y=math.floor(e.position.y+p.position.y)} end
end
local pipes,blocked={},{}
if #sinks>0 then
local routed,issues=engine.fluids.solve({kind='fluid',area=problem.area,inputs=roots,outputs=sinks,obstacles=obstacles,priority=priority,reservations=reserved,
 tiers={pipe=problem.tiers.pipe,underground=problem.tiers.pipe_underground}},pack)
assert(routed,'Native plan fluid routing failed: '..tostring(issues and issues[1] and issues[1].message))
for _,e in ipairs(routed.blueprint.blueprint.entities) do
 local id=add(e.name,e.position.x,e.position.y,{direction=e.direction or 0})
 local k=engine.blueprint.tile_key(math.floor(e.position.x),math.floor(e.position.y));pipes[k]=id;blocked[k]=true
end
end
for _,entry in ipairs{{sources,'input'},{sinks,'output'}} do for _,port in ipairs(entry[1]) do if port.external then
 ports[#ports+1]={entity=assert(pipes[engine.blueprint.tile_key(math.floor(port.position.x),math.floor(port.position.y))]),
  item=port.fluid,kind=entry[2],position=port.position,perMinute=port.perMinute}
end end end
if not problem.logistics then
 local pinned={} for _,p in ipairs(ports) do pinned[#pinned+1]=p end
 for _,p in ipairs(sources) do pinned[#pinned+1]=p end
 for _,p in ipairs(sinks) do pinned[#pinned+1]=p end
 entities=compress(entities,pinned,pack)
 local index={};blocked={}
 for i,e in ipairs(entities) do index[e.position.x..','..e.position.y]=i;if pack.pipes[e.name] then blocked[engine.blueprint.tile_key(math.floor(e.position.x),math.floor(e.position.y))]=true end end
 for _,p in ipairs(ports) do p.entity=assert(index[p.position.x..','..p.position.y]) end
end
local powered={}
for _,e in ipairs(entities) do if not pack.pipes[e.name] then powered[#powered+1]=e end end
local power=engine.power.cover(powered,pack,{area=problem.area,blocked=blocked,poles={problem.tiers.pole}})
assert(power.unpowered==0 and not power.split,'Could not power the complete native plan')
local poles,wires={},{}
for _,p in ipairs(power.poles) do poles[p.position.x..','..p.position.y]=add(p.name,p.position.x,p.position.y) end
for _,wire in ipairs(power.wires) do local a,b=wire[1],wire[2];wires[#wires+1]={assert(poles[a.x..','..a.y]),5,assert(poles[b.x..','..b.y]),5} end
assert(#entities<=2000,'Native plan needs '..#entities..' entities; split the plan to stay within 2000')
local tiles,occupied={},{ }
for _,e in ipairs(entities) do
 local machine=pack.machines[e.name] or pack.furnaces[e.name]
 for _,floor in ipairs(machine and machine.flooring or {}) do
  local a,b=floor.area.left_top,floor.area.right_bottom
  for x=math.floor(e.position.x+a.x),math.ceil(e.position.x+b.x)-1 do for y=math.floor(e.position.y+a.y),math.ceil(e.position.y+b.y)-1 do
   local k=x..','..y;assert(not occupied[k] or occupied[k]==floor.name,'Machine floor requirements conflict')
   if not occupied[k] then occupied[k]=floor.name;tiles[#tiles+1]={name=floor.name,position={x=x,y=y}} end
  end end
 end
end
for _,e in ipairs(entities) do e.entity_number=nil end
return {entities=entities,wires=wires,tiles=tiles,inputs=inputs,steps=steps,ports=ports,warnings={
 problem.logistics and 'Native planner quantities, connected fluid headers and robot-fed external items. Live logistics coverage, ordinary robots and external power are required.' or 'Saved machine counts with routed belts, fluids and power. External supplies and power are required.'}}
