-- Place the planner's exact machines in shared belt rows; fluids are routed afterwards.
local engine=require('engine.init')
local entities,ports,sources,sinks,steps,rows,fluid_clearance={},{},{},{},{},{},{}
local function add(name,x,y,settings)
 local e=settings or {};e.name=name;e.position={x=x,y=y};e.direction=e.direction or 0
 entities[#entities+1]=e;e.entity_number=#entities;return #entities
end
local function rate(parts,item)
 for _,part in ipairs(parts) do if part.type=='item' and part.name==item then return part.perMinute end end
 return 0
end
local loader
for name in pairs(pack.loaders or {}) do if not loader or name<loader then loader=name end end
local arm=pack.inserters[problem.tiers.inserter]
local belt_capacity=pack.belts[problem.tiers.belt].items_per_second*60
local made={}
for _,line in ipairs(pack.plan.lines) do for _,p in ipairs(line.products) do if p.type=='item' then made[p.name]=true end end end
local function belts_for(line,recipe)
 -- A high-volume ingredient gets both lanes; adjustable reach serves the second belt.
 if #recipe.ingredients==2 then
  local a,b=recipe.ingredients[1].name,recipe.ingredients[2].name
  if rate(line.ingredients,a)<rate(line.ingredients,b) then a,b=b,a end
  if rate(line.ingredients,a)>belt_capacity/2 then return {inner={b},outer_behind=a,lead=0,alone={[a]=true,[b]=true}} end
 end
 return engine.rows.belts_for(line.recipe,recipe,made)
end
local function geometry(line,width)
 local recipe=pack.recipes[line.recipe]
 local machine=pack.machines[line.machine] or pack.furnaces[line.machine]
 local w,h=table.unpack(machine.native_size or machine.size)
 local products={} for _,p in ipairs(recipe.results) do if p.type=='item' then products[#products+1]=p end end
 assert(#products<=1,'Belt rows with several solid products need filtered output lanes: '..line.recipe)
 local belts,issue=belts_for(line,recipe);assert(belts,issue and issue.message)
 local outer=belts.outer_behind and 1 or 0
 local long=problem.tiers.long_inserter and pack.inserters[problem.tiers.long_inserter]
 local reach=long and (long.custom and long.custom.cross and long.custom.range>=2 or math.max(math.abs(long.pickup_position[1]),math.abs(long.pickup_position[2]))>=2)
 assert(outer==0 or reach,'This recipe needs researched adjustable reach or a long-handed inserter: '..line.recipe)
 local has_in,has_out=#recipe.ingredients>0,#products>0
 local overhead=(has_in and 2+outer or 0)+(has_out and 2 or 0)
 local pins=recipe.fluid_connections or {}
 if #pins==0 then for _,list in ipairs{recipe.fluid_inputs or {},recipe.fluid_outputs or {}} do for _,pin in ipairs(list) do pins[#pins+1]=pin end end end
 local function clearance(axis,base,minimum)
  for gap=minimum,minimum+6 do
   local fits=true
   for _,a in ipairs(pins) do for _,b in ipairs(pins) do if a.name~=b.name then
    local dx=a.position.x-b.position.x-(axis=='x' and base+gap or 0)
    local dy=a.position.y-b.position.y-(axis=='y' and base+gap or 0)
    if math.abs(dx)+math.abs(dy)<=1 then fits=false end
   end end end
   if fits then return gap end
  end
  error('Fluid sockets need more clearance: '..line.recipe,0)
 end
 local gap=clearance('x',w,problem.layout.spacing=='spacious' and 6 or (#pins>1 and 6 or 2))
 -- Multiple fluid channels retain service corridors even in compact mode; shrink after native qualification.
 local row_gap=clearance('y',h+overhead,problem.layout.spacing=='spacious' and 2 or (#pins>1 and 2 or 0))
 local pitch=w+gap
 local count=math.ceil(line.machines-1e-9)
 local columns=math.min(count,math.floor((width+gap-belts.lead)/pitch))
 if columns<1 then return nil end
 local row_height=h+overhead+row_gap
 local boundary=1;for _,pin in ipairs(pins) do if math.abs(pin.position.y)>=h/2 then boundary=2 end end
 return {recipe=recipe,w=w,h=h,products=products,belts=belts,outer=outer,has_in=has_in,has_out=has_out,count=count,
  pitch=pitch,columns=columns,row_height=row_height,width=columns*pitch-gap+belts.lead,
  height=math.ceil(count/columns)*row_height-row_gap+boundary}
end
local selected,best_score,bounds_height,minimum_height
for width=1,problem.area[2][1]-10 do
 local x,y,shelf_height,used,valid=8,2,0,0,true
 local specs={}
 for index,line in ipairs(pack.plan.lines) do if line.machines>1e-6 then
  local s=geometry(line,width)
  if not s then valid=false;break end
  if x+s.width>8+width then x=8;y=y+shelf_height;shelf_height=0 end
  s.left=x+s.belts.lead;s.top=y;specs[index]=s
  x=x+s.width+3;shelf_height=math.max(shelf_height,s.height);used=math.max(used,x-11)
 end end
 local height=y+shelf_height
 if valid then
  minimum_height=not minimum_height and height or math.min(minimum_height,height)
  if height<=problem.area[2][2]-1 then
   local shape=problem.layout.shape
   local score=shape=='tall' and used*1000+height or shape=='wide' and height*1000+used or math.abs(used-height)*1000+used*height
   if not best_score or score<best_score then selected,best_score,bounds_height=specs,score,height end
  end
 end
end
assert(selected,'The complete saved plan needs at least '..tostring(minimum_height or 'more')..' tiles of height at this width; enlarge the block without reducing production')
for index,line in ipairs(pack.plan.lines) do if line.machines>0.000001 then
 local s=selected[index]
 local recipe,w,h,products,belts,outer,has_in,has_out,count,pitch,columns,row_height=s.recipe,s.w,s.h,s.products,s.belts,s.outer,s.has_in,s.has_out,s.count,s.pitch,s.columns,s.row_height
 local y=s.top
 local production=0;for _,p in ipairs(line.products) do if p.type~='entity' then production=production+p.perMinute end end
 steps[#steps+1]={recipe=line.recipe,machines=count,perMinute=production}
 for first=1,count,columns do
  local n=math.min(columns,count-first+1)
  local left=s.left
  local ym=y+(has_in and 2+outer or 0)
  local right=left+(n-1)*pitch+w-1
  local ib=has_in and {x1=left-belts.lead,x2=right,y=y+outer} or nil
  local ob=has_out and {x1=left,x2=right,y=ym+h+1} or nil
  local function strip(row)
   if row then for x=row.x1,row.x2 do add(problem.tiers.belt,x+.5,row.y+.5,{direction=4}) end end
  end
  strip(ib);strip(ob)
  if outer==1 then strip{x1=ib.x1,x2=right,y=y} end
  local row={recipe=line.recipe,copy=#rows+1,ingredients=belts.inner,inner=belts.inner,merge=belts.merge,
   outer_behind=belts.outer_behind,outer_side=belts.outer_side,outer_belt=outer==1 and {x1=ib.x1,x2=right,y=y} or nil,
   input_belt=ib,output_belt=ob,item=products[1] and products[1].name,last_first_machine_inserter_x=left+math.floor(w/2),last_first_machine_long_x=left+w-1}
  rows[#rows+1]=row
  for _,p in ipairs(recipe.ingredients) do
   local per_row=rate(line.ingredients,p.name)*n/count
   local lane=(#recipe.ingredients==1 or belts.alone[p.name]) and belt_capacity or belt_capacity/2
   assert(per_row<=lane+1e-6,'The '..p.name..' supply exceeds this belt tier; select a faster belt or split the block')
  end
  if products[1] then assert(rate(line.products,products[1].name)*n/count<=belt_capacity/2+1e-6,'The '..products[1].name..' row exceeds one belt lane; select a faster belt') end
  for i=0,n-1 do
   local x=left+i*pitch
   local center={x=x+w/2,y=ym+h/2}
   local settings={direction=recipe.direction or 4};if not pack.furnaces[line.machine] then settings.recipe=line.recipe end
   add(line.machine,center.x,center.y,settings)
   local function transfer(input,amount,outer_arm)
    local cap=(arm.stack_size or 1)*arm.rotation_speed*60*.6*60
    local k=math.max(1,math.ceil(amount/count/cap-1e-9))
    -- A parallel feed belt cannot side-load a loader intake. Use inserters for
    -- inputs until splitter branches have a native-qualified template.
    local direct=loader and not input
    if direct then k=1 end
    assert(k<=w,'Inserters cannot keep up with '..line.recipe..'; a compatible researched loader or faster inserter is needed')
    for a=1,k do
     local col=math.floor(w/2)+(a%2==0 and -a/2 or (a-1)/2)
     if outer_arm then col=w-1 end
     local ay=input and ym-1+.5 or ym+h+.5
     if direct then
      add(loader,x+col+.5,ay,{direction=input and 0 or 8,type=input and 'input' or 'output'})
     else
      local vectors
      local selected=outer_arm and problem.tiers.long_inserter or problem.tiers.inserter
      if arm.custom and arm.custom.cross and arm.custom.range>=(outer_arm and 2 or 1) then
       local reach=outer_arm and 2 or 1
       vectors={pickup_position={x=0,y=-reach},drop_position={x=0,y=reach+(arm.custom.offsets and 51/256 or 0)}}
      end
      add(selected,x+col+.5,ay,vectors)
     end
    end
   end
   if has_in then
    local inner,far=0,0
    for _,p in ipairs(recipe.ingredients) do if p.name==belts.outer_behind or p.name==belts.outer_side then far=far+rate(line.ingredients,p.name) else inner=inner+rate(line.ingredients,p.name) end end
    transfer(true,inner,false);if far>0 then transfer(true,far,true) end
   end
   if has_out then transfer(false,rate(line.products,products[1].name),false) end
   local function fluid_port(p,list)
    local pos={x=center.x+p.position.x,y=center.y+p.position.y}
    local dx=math.abs(p.position.x)>=w/2 and (p.position.x>0 and 1 or -1) or 0
    local dy=math.abs(p.position.y)>=h/2 and (p.position.y>0 and 1 or -1) or 0
    list[#list+1]={fluid=p.name,position=pos,direction=0,access={x=math.floor(pos.x)+dx,y=math.floor(pos.y)+dy}}
    for distance=0,1 do fluid_clearance[#fluid_clearance+1]={x=math.floor(pos.x)+dx*distance,y=math.floor(pos.y)+dy*distance} end
   end
   for _,p in ipairs(recipe.fluid_inputs or {}) do fluid_port(p,sinks) end
   for _,p in ipairs(recipe.fluid_outputs or {}) do fluid_port(p,sources) end
  end
  y=y+row_height
 end
end end
local y=bounds_height
-- Merge low-rate identical products onto one shared output spine instead of routing
-- parallel copies of the same item around the entire factory.
local buses={}
local producer_items={}
for _,row in ipairs(rows) do if row.item then producer_items[row.item]=true end end
local product_count=0;for _ in pairs(producer_items) do product_count=product_count+1 end
if product_count==1 then
 for _,port in ipairs(problem.outputs) do if port.type~='fluid' and producer_items[port.item] and port.perMinute<=belt_capacity/2 then
  local internal=false
  for _,r in ipairs(rows) do for _,name in ipairs(r.inner) do if name==port.item then internal=true end end end
  if not internal then
   local x=problem.area[2][1]-1;local bottom=math.min(problem.area[2][2]-3,y-1);local top=bottom
   for _,r in ipairs(rows) do if r.item==port.item then
    top=math.min(top,r.output_belt.y)
    for bx=r.output_belt.x2+1,x-1 do add(problem.tiers.belt,bx+.5,r.output_belt.y+.5,{direction=4}) end
    r.output_belt=nil
   end end
   for by=top,bottom do add(problem.tiers.belt,x+.5,by+.5,{direction=8}) end
   buses[port.item]={item=port.item,from={x=x,y=bottom+1,dir=8,from_x=x,from_y=bottom,label='output spine '..port.item},
    goals={{x=math.floor(port.position.x),y=math.floor(port.position.y),dirs=engine.routing.into_port(port)}},label='output spine '..port.item}
  end
 end end
end
local item_problem={area=problem.area,tiers=problem.tiers,inputs=problem.inputs,outputs={},obstacles=problem.obstacles,item_headers={}}
for _,p in ipairs(problem.inputs) do
 assert(p.perMinute<=belt_capacity+1e-6,'The '..p.item..' input exceeds the selected belt capacity')
 local id=add(problem.tiers.belt,p.position.x,p.position.y,{direction=p.direction})
 ports[#ports+1]={entity=id,item=p.item,kind='input',position=p.position,perMinute=p.perMinute}
end
for _,p in ipairs(problem.outputs) do if p.type~='fluid' then
 if not buses[p.item] then item_problem.outputs[#item_problem.outputs+1]=p end
 local id=add(problem.tiers.belt,p.position.x,p.position.y,{direction=p.direction})
 ports[#ports+1]={entity=id,item=p.item,kind='output',position=p.position,perMinute=p.perMinute}
end end
-- Internal solid intermediates return through one header before splitting to consumers.
local internal={}
for _,row in ipairs(rows) do for _,item in ipairs(row.inner) do if made[item] then internal[item]=true end end
 for _,item in ipairs{row.outer_behind,row.outer_side} do if item and made[item] then internal[item]=true end end
end
local names={} for name in pairs(internal) do names[#names+1]=name end;table.sort(names)
for i,name in ipairs(names) do
 local p={item=name,position={x=.5,y=18.5+(i-1)*3},direction=4}
 assert(p.position.y<problem.area[2][2],'No room for an internal item header')
 item_problem.item_headers[name]=p
 item_problem.outputs[#item_problem.outputs+1]=p
 add(problem.tiers.belt,p.position.x,p.position.y,{direction=p.direction})
end
local obstacles={};for _,p in ipairs(item_problem.obstacles or {}) do obstacles[#obstacles+1]=p end
for _,p in ipairs(fluid_clearance) do obstacles[#obstacles+1]=p end
item_problem.obstacles=obstacles
local nets,errors,extras=engine.routing.nets({rows=rows},item_problem,pack,entities)
assert(nets,errors and errors[1] and errors[1].message)
for _,e in ipairs(extras) do add(e.name,e.position.x,e.position.y,{direction=e.direction,type=e.type,output_priority=e.output_priority}) end
for _,p in ipairs(problem.outputs) do if buses[p.item] then nets[#nets+1]=buses[p.item] end end
if #nets>0 then
  engine.routing.GREEDY_ORDERS=3;engine.routing.NEGOTIATION_ROUNDS=3
 local job=engine.routing.route_new(nets,entities,item_problem,pack,engine.routing.new_counter(60000))
 while not job.done do engine.routing.route_step(job,pack,2000) end
 assert(job.result,job.errors and job.errors[1] and job.errors[1].message)
 for _,e in ipairs(job.result) do add(e.name,e.position.x,e.position.y,{direction=e.direction,type=e.type}) end
end
return {entities=entities,ports=ports,sources=sources,sinks=sinks,steps=steps}
