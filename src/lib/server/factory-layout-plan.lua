local engine=require('engine.init')
local plan=assert(pack.plan,'Missing native production plan')
local entities,ports,sources,sinks,inputs,steps={},{},{},{},{},{}
local demand,available,requested,reserved={},{},{},{}
local circuits={}
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
  local settings,wire,connector,gate=options.machine_settings(line,pack)
  local id=add(line.machine,x,center,settings)
  if wire then circuits[#circuits+1]={entity=entities[id],reach=wire,connector=connector,gate=gate} end
  for _,p in ipairs(recipe.fluid_connections or {}) do reserved[#reserved+1]={fluid=p.name,x=math.floor(x+p.position.x),y=math.floor(center+p.position.y)} end
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
 entities,ports,sources,sinks,steps,reserved=placed.entities,placed.ports,placed.sources,placed.sinks,placed.steps,placed.reservations
 circuits=placed.circuits
end
-- Gate the pipe before a disposal input: disabled furnaces still trap fluid in their one-way input buffers.
for _,c in ipairs(circuits) do if c.gate then
 local recipe=pack.recipes[c.gate];local d=recipe.disposal;local p=recipe.fluid_inputs[1]
 local dx=p.position.x>0 and 1 or -1;local dy=0
 if math.abs(p.position.y)>= (pack.furnaces[c.entity.name].size[2]/2) then dx=0;dy=p.position.y>0 and 1 or -1 end
 local x,y=c.entity.position.x+p.position.x,c.entity.position.y+p.position.y
 local id=add(d.gate,x+dx*.5,y+dy*.5,{direction=dx<0 and 4 or dx>0 and 12 or dy<0 and 8 or 0,
  control_behavior={circuit_enabled=true,circuit_condition={first_signal={type='fluid',name=d.fluid},comparator='>',constant=d.threshold}}})
 for _,sink in ipairs(sinks) do if sink.fluid==d.fluid and sink.position.x==x and sink.position.y==y then
  sink.position={x=x+dx*2,y=y+dy*2};sink.access={x=math.floor(sink.position.x)+dx,y=math.floor(sink.position.y)+dy}
 end end
 c.entity=entities[id]
end end
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
local pipes,blocked={},{}
if #sinks>0 then
problem.phase='fluid routing'
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
local circuit_needs={}
for _,c in ipairs(circuits) do circuit_needs[#circuit_needs+1]={x=c.entity.position.x,y=c.entity.position.y,reach=c.reach} end
local power=engine.power.cover(powered,pack,{area=problem.area,blocked=blocked,poles={problem.tiers.pole},circuits=circuit_needs})
assert(power.unpowered==0 and not power.split,'Could not power the complete native plan')
local poles,wires={},{}
for _,p in ipairs(power.poles) do poles[p.position.x..','..p.position.y]=add(p.name,p.position.x,p.position.y) end
for _,wire in ipairs(power.wires) do local a,b=wire[1],wire[2];wires[#wires+1]={assert(poles[a.x..','..a.y]),5,assert(poles[b.x..','..b.y]),5} end
-- Red networks read local disposal buffers. Green carries normal-consumer demand between stages.
local groups,green={},false
for _,c in ipairs(circuits) do
 local chosen,distance
 for _,p in ipairs(power.poles) do
  local reach=math.min(c.reach,pack.poles[p.name].circuit_reach or 0)
  local d=(p.position.x-c.entity.position.x)^2+(p.position.y-c.entity.position.y)^2
  if d<=reach^2 and (not distance or d<distance) then chosen,distance=p,d end
 end
 assert(chosen,'No circuit pole reaches the controlled machine')
 local id=poles[chosen.position.x..','..chosen.position.y]
 wires[#wires+1]={c.entity.entity_number,c.connector,id,c.connector}
 local condition=c.entity.control_behavior.circuit_condition
 if c.connector==2 then green=true end
 if condition then
  local k=(c.connector==2 and 'green' or id)..'/'..c.connector..'/'..condition.first_signal.name..'/'..condition.comparator
  groups[k]=groups[k] or {conditions={},threshold=0}
  local g=groups[k];g.conditions[#g.conditions+1]=condition
  g.threshold=c.connector==2 and math.max(g.threshold,condition.constant) or g.threshold+condition.constant
 end
end
for _,g in pairs(groups) do for _,condition in ipairs(g.conditions) do condition.constant=g.threshold end end
if green then
 -- Reuse the power tree when native circuit reach covers each hop.
 local direct=true
 for _,wire in ipairs(power.wires) do
  local a,b=wire[1],wire[2]
  local pa,pb=entities[poles[a.x..','..a.y]],entities[poles[b.x..','..b.y]]
  local reach=math.min(pack.poles[pa.name].circuit_reach or 0,pack.poles[pb.name].circuit_reach or 0)
  if (a.x-b.x)^2+(a.y-b.y)^2>reach^2 then direct=false;break end
 end
 if direct then
  for _,wire in ipairs(power.wires) do local a,b=wire[1],wire[2];wires[#wires+1]={poles[a.x..','..a.y],2,poles[b.x..','..b.y],2} end
 else
  local circuit_pack={poles={}}
  for name,p in pairs(pack.poles) do local copy={};for k,v in pairs(p) do copy[k]=v end;copy.reach=p.circuit_reach or 0;circuit_pack.poles[name]=copy end
  local taken={}
  for _,e in ipairs(engine.blueprint.load({entities=entities},pack).entities) do for _,tile in ipairs(e.tiles) do taken[engine.blueprint.tile_key(tile[1],tile[2])]=true end end
  local joined,issues=engine.power.connect(power.poles,circuit_pack,{area=problem.area,blocked=taken,poles={problem.tiers.pole}})
  assert(joined,'Cannot connect fluid demand circuits: '..tostring(issues and issues[1] and issues[1].message))
  local added={}
  for i,p in ipairs(joined.poles) do added[i]=add(p.name,p.position.x,p.position.y) end
  local function endpoint(ref) local p=ref.existing and power.poles[ref.existing];return p and poles[p.position.x..','..p.position.y] or added[ref.new] end
  for _,wire in ipairs(joined.wires) do wires[#wires+1]={endpoint(wire[1]),2,endpoint(wire[2]),2} end
 end
end
assert(#entities<=problem.max_entities,'Native plan needs '..#entities..' entities; split the plan to stay within '..problem.max_entities)
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
