-- Place the planner's exact machines in shared belt rows; fluids are routed afterwards.
local engine=require('engine.init')
local entities,ports,sources,sinks,steps,rows,fluid_clearance,reservations={},{},{},{},{},{},{},{}
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
local consumed={}
for _,line in ipairs(pack.plan.lines) do for _,p in ipairs(line.ingredients) do if p.type=='item' then consumed[p.name]=true end end end
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
 assert(#products<=2,'More than two solid products need a qualified sorting junction: '..line.recipe)
 if #products>1 then assert((arm.filter_count or 0)>0,'Select an inserter with item filters for '..line.recipe) end
 local belts,issue=belts_for(line,recipe);assert(belts,issue and issue.message)
 for _,part in ipairs(recipe.ingredients) do if made[part.name] then belts.lead=math.max(belts.lead,3) end end
 local outer=belts.outer_behind and 1 or 0
 local long=problem.tiers.long_inserter and pack.inserters[problem.tiers.long_inserter]
 local reach=long and (long.custom and long.custom.cross and long.custom.range>=2 or math.max(math.abs(long.pickup_position[1]),math.abs(long.pickup_position[2]))>=2)
 assert(outer==0 or reach,'This recipe needs researched adjustable reach or a long-handed inserter: '..line.recipe)
 local has_in,has_out=#recipe.ingredients>0,#products>0
 local overhead=(has_in and 2+outer or 0)+(has_out and #products+1 or 0)
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
 -- Split physical rows at lane capacity; never reduce the saved machine count.
 for _,part in ipairs(recipe.ingredients) do
  local lane=(#recipe.ingredients==1 or belts.alone[part.name]) and belt_capacity or belt_capacity/2
  local required=rate(line.ingredients,part.name)
  if required>0 then columns=math.min(columns,math.floor(lane*count/required+1e-9)) end
 end
 for _,part in ipairs(products) do local required=rate(line.products,part.name)
  if required>0 then columns=math.min(columns,math.floor(belt_capacity/2*count/required+1e-9)) end
 end
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
if not selected then
 -- Fill earlier shelves with the small service stages before rejecting the block.
 for width=1,problem.area[2][1]-10 do
  local specs,ordered={},{}
  for index,line in ipairs(pack.plan.lines) do if line.machines>1e-6 then
   local spec=geometry(line,width)
   if not spec then ordered=nil;break end
   specs[index]=spec;ordered[#ordered+1]={index=index,spec=spec}
  end end
  if ordered then
   table.sort(ordered,function(a,b) return a.spec.height>b.spec.height or a.spec.height==b.spec.height and (a.spec.width>b.spec.width or a.spec.width==b.spec.width and a.index<b.index) end)
   local shelves,y,used={},2,0
   for _,entry in ipairs(ordered) do
    local s=entry.spec;local shelf
    for _,candidate in ipairs(shelves) do if candidate.x+s.width<=8+width then shelf=candidate;break end end
    if not shelf then shelf={x=8,y=y,height=s.height};shelves[#shelves+1]=shelf;y=y+s.height end
    s.left=shelf.x+s.belts.lead;s.top=shelf.y
    shelf.x=shelf.x+s.width+3;used=math.max(used,shelf.x-11)
   end
   minimum_height=math.min(minimum_height or y,y)
   if y<=problem.area[2][2]-1 then
    local shape=problem.layout.shape
    local score=shape=='tall' and used*1000+y or shape=='wide' and y*1000+used or math.abs(used-y)*1000+used*y
    if not best_score or score<best_score then selected,best_score,bounds_height=specs,score,y end
   end
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
  local output_belts={}
  for j=1,#products do output_belts[j]={x1=left,x2=right,y=ym+h+j} end
  local ob=output_belts[1]
  local function strip(row)
   if row then for x=row.x1,row.x2 do add(problem.tiers.belt,x+.5,row.y+.5,{direction=4}) end end
  end
  strip(ib);for _,belt in ipairs(output_belts) do strip(belt) end
  if loader and #products==1 and consumed[products[1].name] then
   -- Loaders fill both lanes; side-load them onto one right lane before routing.
   add(problem.tiers.belt,right+1+.5,ob.y+.5,{direction=0})
   add(problem.tiers.belt,right+1+.5,ob.y-1+.5,{direction=4})
   ob={x1=right+1,x2=right+1,y=ob.y-1}
  end
  local outer_belt=outer==1 and {x1=left,x2=right,y=y} or nil
  strip(outer_belt)
  local row={recipe=line.recipe,copy=#rows+1,ingredients=belts.inner,inner=belts.inner,merge=belts.merge,
   outer_behind=belts.outer_behind,outer_side=belts.outer_side,outer_belt=outer_belt,
   ingredient_rates={},alone=belts.alone,input_belt=ib,output_belt=ob,product_rate=products[1] and rate(line.products,products[1].name)*n/count,item=products[1] and products[1].name,last_first_machine_inserter_x=left+math.floor(w/2),last_first_machine_long_x=left+w-1}
  for _,p in ipairs(recipe.ingredients) do row.ingredient_rates[p.name]=rate(line.ingredients,p.name)*n/count end
  rows[#rows+1]=row
  for j=2,#products do rows[#rows+1]={recipe=line.recipe,copy=#rows+1,ingredients={},inner={},output_belt=output_belts[j],product_rate=rate(line.products,products[j].name)*n/count,item=products[j].name} end
  for _,p in ipairs(recipe.ingredients) do
   local per_row=rate(line.ingredients,p.name)*n/count
   local lane=(#recipe.ingredients==1 or belts.alone[p.name]) and belt_capacity or belt_capacity/2
   assert(per_row<=lane+1e-6,'The '..p.name..' supply exceeds this belt tier; select a faster belt or split the block')
  end
  for _,p in ipairs(products) do assert(rate(line.products,p.name)*n/count<=belt_capacity/2+1e-6,'The '..p.name..' row exceeds one belt lane; select a faster belt') end
  for i=0,n-1 do
   local x=left+i*pitch
   local center={x=x+w/2,y=ym+h/2}
   local settings={direction=recipe.direction or 4};if not pack.furnaces[line.machine] then settings.recipe=line.recipe end
   add(line.machine,center.x,center.y,settings)
   for _,p in ipairs(recipe.fluid_connections or {}) do reservations[#reservations+1]={fluid=p.name,x=math.floor(center.x+p.position.x),y=math.floor(center.y+p.position.y)} end
   local output_column=0
   local function transfer(input,amount,outer_arm,product,output_lane)
    local cap=(arm.stack_size or 1)*arm.rotation_speed*60*.6*60
    local k=math.max(1,math.ceil(amount/count/cap-1e-9))
    -- A parallel feed belt cannot side-load a loader intake. Use inserters for
    -- inputs until splitter branches have a native-qualified template.
    local direct=loader and not input and #products==1
    if direct then k=1 end
    assert(k<=w,'Inserters cannot keep up with '..line.recipe..'; a compatible researched loader or faster inserter is needed')
    for a=1,k do
     local col=math.floor(w/2)+(a%2==0 and -a/2 or (a-1)/2)
     if outer_arm then col=w-a end
     if not input and #products>1 then
      output_column=output_column+1;col=math.floor(w/2)+(output_column%2==0 and -output_column/2 or (output_column-1)/2)
      assert(col>=0 and col<w,'Filtered output inserters do not fit '..line.recipe)
     end
     local ay=input and ym-1+.5 or ym+h+.5
     if direct then
      add(loader,x+col+.5,ay,{direction=input and 0 or 8,type=input and 'input' or 'output'})
     else
      local vectors
      local reach=outer_arm and 2 or output_lane or 1
      local selected=(outer_arm or reach>1) and problem.tiers.long_inserter or problem.tiers.inserter
      local profile=assert(selected and pack.inserters[selected],'This output needs researched adjustable reach or a long-handed inserter: '..line.recipe)
      if profile.custom and profile.custom.cross and profile.custom.range>=reach then
       vectors={pickup_position={x=0,y=input and -reach or -1},drop_position={x=0,y=reach+(profile.custom.offsets and 51/256 or 0)}}
      end
      if not input and #products>1 then
       assert((profile.filter_count or 0)>0,'The output inserter needs item filters: '..line.recipe)
       vectors=vectors or {};vectors.use_filters=true;vectors.filters={{index=1,name=product}}
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
   for j,p in ipairs(products) do transfer(false,rate(line.products,p.name),false,p.name,j) end
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
local item_problem={area=problem.area,tiers=problem.tiers,inputs=problem.inputs,outputs={},obstacles=problem.obstacles,item_headers={},link_sources={},prioritise_inputs=true,max_route_expansions=8000,heuristic_weight=2}
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
-- Connect intermediate production directly to consumer lanes. A forced common
-- header can bottleneck a multi-belt item even when each row fits the tier.
local internal={}
for _,row in ipairs(rows) do for _,item in ipairs(row.inner) do if made[item] then internal[item]=true end end
 for _,item in ipairs{row.outer_behind,row.outer_side} do if item and made[item] then internal[item]=true end end
end
local junctions=0
local names={} for name in pairs(internal) do names[#names+1]=name end;table.sort(names)
for _,item in ipairs(names) do
 local supply,consumers={},{}
 for _,row in ipairs(rows) do
  if row.item==item and row.output_belt then supply[#supply+1]={source=item..'#'..row.copy,left=row.product_rate} end
  local needed=row.ingredient_rates and row.ingredient_rates[item]
  if needed and needed>1e-6 then consumers[#consumers+1]={row=row,needed=needed} end
 end
 for _,port in ipairs(problem.inputs) do if port.item==item then supply[#supply+1]={source=item,left=port.perMinute} end end
 table.sort(consumers,function(a,b) return a.needed>b.needed or a.needed==b.needed and a.row.copy<b.row.copy end)
 local next_source=1
 for _,consumer in ipairs(consumers) do
  local row,needed=consumer.row,consumer.needed
  local outer=item==row.outer_behind or item==row.outer_side
  local belt=outer and row.outer_belt or row.input_belt
  local last=outer and row.last_first_machine_long_x or row.last_first_machine_inserter_x
  local both=outer and not row.outer_side or not outer and #row.inner==1
  local right=true
  if outer then right=item==row.outer_behind
  elseif not both then
   local sorted={} for _,name in ipairs(row.inner) do sorted[#sorted+1]=name end
   table.sort(sorted,function(a,b) if (made[a] or false)~=(made[b] or false) then return made[a] or false end return a<b end)
   right=item==sorted[1]
  end
  row.supplies=row.supplies or {};row.supplies[item]={}
  while needed>1e-6 do
   local lane=math.min(needed,belt_capacity/2)
   local goals={}
   if right then goals[#goals+1]={x=belt.x1,y=belt.y,dirs={[4]=true}} end
   for x=belt.x1,last do goals[#goals+1]={x=x,y=belt.y,dirs={[right and 0 or 8]=true}} end
   local remaining=lane
   local feeds={}
   while remaining>1e-6 do
    local source=assert(supply[next_source],'Native plan has no '..item..' supply for '..row.recipe)
    local amount=math.min(source.left,remaining)
    if amount>1e-6 then feeds[#feeds+1]=source.source end
    source.left=source.left-amount;remaining=remaining-amount
    if source.left<=1e-6 then next_source=next_source+1 end
   end
   local source=feeds[1]
   if #feeds>1 then
    -- Merge partial producer rows before assigning the ingredient to a lane.
    -- Separate routes cannot share the same mandatory approach tile.
    junctions=junctions+1
    local x,y=1,18+(junctions-1)*3
    assert(y<problem.area[2][2]-2,'No room for an ingredient merge junction')
    for offset=0,#feeds-1 do add(problem.tiers.belt,x+offset+.5,y+.5,{direction=4}) end
    source=item..'#merge'..junctions
    local tail=x+#feeds-1
    item_problem.link_sources[source]={x=tail+1,y=y,dir=4,from_x=tail,from_y=y,label='merge '..item..' '..junctions}
    item_problem.outputs[#item_problem.outputs+1]={item=item,sources=feeds,merge_lane=true,position={x=x+.5,y=y+.5},direction=4}
   end
   row.supplies[item][#row.supplies[item]+1]={source=source,goals=goals}
   needed=needed-lane
   assert(needed<=1e-6 or both,'The '..item..' ingredient exceeds one allocated belt lane')
   right=false
  end
 end
 -- Only surplus producers may also feed a declared output of this intermediate.
 for _,out in ipairs(item_problem.outputs) do if out.item==item and not out.sources then
  out.sources={};out.source_rates={};local needed=out.perMinute
  for _,source in ipairs(supply) do if source.left>1e-6 and needed>1e-6 then
   out.sources[#out.sources+1]=source.source
   local amount=math.min(source.left,needed);out.source_rates[source.source]=amount;source.left=source.left-amount;needed=needed-amount
  end end
  assert(needed<1e-6,'Native plan has no surplus '..item..' for its output')
 end end
end
-- A shared single-item belt can pass through its consumer rows in sequence.
-- Splitter stairs otherwise bank minutes of supplies in low-rate branches.
for _,input in ipairs(problem.inputs) do if not made[input.item] then
 local consumers,pure={},true
 for _,row in ipairs(rows) do if row.ingredient_rates and row.ingredient_rates[input.item] then
  local outer=row.outer_behind==input.item or row.outer_side==input.item
  if outer and row.outer_side or not outer and #row.inner~=1 then pure=false end
  consumers[#consumers+1]={row=row,belt=outer and row.outer_belt or row.input_belt}
 end end
 if pure and #consumers>1 then
  local source=input.item;local x,y=input.position.x,input.position.y
  while #consumers>0 do
   local best,distance
   for i,c in ipairs(consumers) do local d=math.abs(c.belt.x1-x)+math.abs(c.belt.y-y)
    if not distance or d<distance then best,distance=i,d end
   end
   local c=table.remove(consumers,best);local row,belt=c.row,c.belt
   row.source_keys=row.source_keys or {};row.source_keys[input.item]=source
   x,y=belt.x2,belt.y
   source=input.item..'#serial'..row.copy
   item_problem.link_sources[source]={x=x+1,y=y,dir=4,from_x=x,from_y=y,label=input.item..' after '..row.recipe}
  end
 end
end end
local obstacles={};for _,p in ipairs(item_problem.obstacles or {}) do obstacles[#obstacles+1]=p end
for _,p in ipairs(fluid_clearance) do obstacles[#obstacles+1]=p end
item_problem.obstacles=obstacles
local nets,errors,extras=engine.routing.nets({rows=rows},item_problem,pack,entities)
assert(nets,errors and errors[1] and errors[1].message)
for _,e in ipairs(extras) do add(e.name,e.position.x,e.position.y,{direction=e.direction,type=e.type,output_priority=e.output_priority}) end
for _,p in ipairs(problem.outputs) do if buses[p.item] then nets[#nets+1]=buses[p.item] end end
if #nets>0 then
 problem.phase='belt routing'
  engine.routing.GREEDY_ORDERS=1;engine.routing.NEGOTIATION_ROUNDS=12
 local job=engine.routing.route_new(nets,entities,item_problem,pack,engine.routing.new_counter(100000))
 while not job.done do engine.routing.route_step(job,pack,2000) end
 assert(job.result,job.errors and job.errors[1] and job.errors[1].message)
 for _,e in ipairs(job.result) do add(e.name,e.position.x,e.position.y,{direction=e.direction,type=e.type}) end
end
return {entities=entities,ports=ports,sources=sources,sinks=sinks,steps=steps,reservations=reservations}
