-- Disposable native trials. Blueprint Sandboxes 3.3 has no automation API;
-- keep its archive and player labs intact until upstream exposes one.
local events=require('events').scope('sandbox')
local M={}
local robotTrial=require('robot-trial')
local PREFIX='toby-trial-'
local function state()
 storage.toby_trials=storage.toby_trials or {sequence=0,jobs={},forces={}}
 return storage.toby_trials
end
local function number(n,lo,hi)
 return type(n)=='number' and n==n and n>=lo and n<=hi
end
local function owner(name,actor)
 local force=game.forces[name]
 if not force or name=='enemy' or name=='neutral' or name:sub(1,#PREFIX)==PREFIX then error('Choose a real player force',0) end
 if actor then
  local p=game.get_player(actor.name)
  if not p or not p.connected or p.force~=force or (actor.requireAdmin and not p.admin) then error('Sandbox player permission changed',0) end
 end
 return force
end
local function job_for(force,id)
 owner(force)
 local job=state().jobs[id]
 if not job or job.owner~=force then error('Sandbox trial not found on this force',0) end
 return job
end
local function key(name,p) return name..':'..p.x..':'..p.y end
local function inventory(e)
 return e.get_inventory(defines.inventory.chest)
end
local function cleanup(surface)
 if not surface or not surface.valid then return true end
 local occupied=false
 for _,p in pairs(game.players) do if p.surface==surface or p.physical_surface==surface then occupied=true;break end end
 if not occupied then local ok,queued=pcall(game.delete_surface,surface);if ok and queued then return true end end
 pcall(function() for _,e in pairs(surface.find_entities()) do pcall(function() e.active=false end) end end)
 return false
end
local function contents(port)
 local e=port.entity
 if not e.valid then error('A test endpoint was removed',0) end
 if port.kind=='fluid' then
  local fluid=e.get_fluid(1)
  return fluid and fluid.name==port.name and fluid.amount or 0
 elseif e.type=='transport-belt' or e.type=='underground-belt' then
  local n=0;for lane=port.lane or 1,port.lane or 2 do n=n+e.get_transport_line(lane).get_item_count(port.name) end;return n
 else return inventory(e).get_item_count(port.name) end
end
local function remove(port)
 local e,n=port.entity,contents(port)
 if n==0 then return 0 end
 if port.kind=='fluid' then local removed=e.remove_fluid(1,n);return removed and removed.amount or 0 end
 if e.type=='transport-belt' or e.type=='underground-belt' then
  local removed=0;for lane=port.lane or 1,port.lane or 2 do if removed<n then removed=removed+e.get_transport_line(lane).remove_item{name=port.name,count=n-removed} end end;return removed
 end
 return inventory(e).remove{name=port.name,count=n}
end
local function feed(port)
 local e=port.entity
 if not e.valid then error('A test input was removed',0) end
 -- At most one second of credit: a blocked source cannot bank a burst.
 port.credit=math.min(math.max(1,port.perMinute/60),port.credit+port.perMinute/3600)
 local added=0
 if port.kind=='fluid' then
  local fluid=e.get_fluid(1)
  if fluid and fluid.name~=port.name then error('Test input contains another fluid',0) end
  added=e.add_fluid(1,{name=port.name,amount=port.credit,temperature=port.temperature})
 else
  local n=math.floor(port.credit)
  if n>0 then
   if e.type=='transport-belt' or e.type=='underground-belt' then
    -- Real belt insertion, lane capacity and downstream backpressure still apply.
    for lane=port.lane or 1,port.lane or 2 do
     if added<n and e.get_transport_line(lane).insert_at_back{name=port.name,count=1} then added=added+1 end
    end
   else added=inventory(e).insert{name=port.name,count=n} end
  end
 end
 port.credit=port.credit-added
 port.supplied=port.supplied+added
end
local function finish(job,status,message)
 local outputs,passed,sufficient={},true,true
 for _,port in ipairs(job.outputs or {}) do
  local elapsed=math.max(0,(job.sampleEnd or game.tick)-job.sampleStart)
  local rate=elapsed>0 and port.delivered*3600/elapsed or 0
  local expected=port.perMinute*elapsed/3600
  local tolerance=port.kind=='item' and port.batch or 0
  local sampleSufficient=expected>=3*port.batch
  local met=sampleSufficient and port.delivered>0 and port.delivered+tolerance>=expected*.95
  outputs[#outputs+1]={name=port.name,kind=port.kind,entity=port.index,lane=port.lane,delivered=port.delivered,perMinute=rate,targetPerMinute=port.perMinute,met=met,sampleSufficient=sampleSufficient,batchTolerance=tolerance}
  passed=passed and met
  sufficient=sufficient and sampleSufficient
 end
 if job.robot then passed=job.robot.passed;sufficient=true;outputs=nil end
 local faults,total={},0
 local statuses={} for name,value in pairs(defines.entity_status) do statuses[value]=name end
 for i,e in ipairs(job.entities or {}) do
  if e.valid and (e.type=='assembling-machine' or e.type=='furnace' or e.type=='mining-drill' or e.type=='inserter') then
   local s=statuses[e.status]
   if job.robot and e.type=='inserter' then
    local b=e.get_or_create_control_behavior()
    if b.circuit_condition and b.circuit_condition.first_signal and not b.circuit_enable_disable then s='circuit_condition_disabled' end
   end
   if s~='working' and s~='normal' and not (job.robot and s=='disabled_by_control_behavior') then
    total=total+1
    if #faults<32 then faults[#faults+1]={entity=i,name=e.name,status=s} end
   end
  end
 end
 local inputs={}
 for _,port in ipairs(job.inputs or {}) do inputs[#inputs+1]={entity=port.index,lane=port.lane,name=port.name,kind=port.kind,perMinute=port.perMinute,supplied=port.supplied} end
 job.result={operation='test_blueprint',id=job.id,designId=job.designId,status=status,passed=status=='done' and passed,mode=job.mode,verdict=status=='done' and (not sufficient and 'inconclusive' or passed and 'passed' or 'below_target') or status,
  sourceSurface=job.source,contextCloned=job.context,simulatedTicks=math.max(0,(job.sampleEnd or game.tick)-job.sampleStart),
  warmupTicks=job.warmup,outputs=outputs,inputs=inputs,faults=faults,faultsTotal=total,error=message,
  robotResults=job.robot and job.robot.evidence or nil,power=job.power,liveFactoryVerified=false,note=job.robot and 'Isolated robot-controller test. Busy demand and near-cap totals use synthetic circuit signals; real job throughput and live supplies are not verified.' or 'Isolated simulation. Declared inputs are synthetic; output endpoints are drained. Live supplies, placement and delivered production still need verification.'}
 job.status=status
 if not cleanup(job.surface) then job.result.cleanupBlocked=true end
 job.entities=nil;job.surface=nil;job.inputs=nil;job.outputs=nil;job.robot=nil
end
function M.read(force,id)
 local job=job_for(force,id)
 if job.result then return job.result end
 return {operation='test_blueprint',id=id,designId=job.designId,status=job.status,tick=game.tick,
  elapsedTicks=game.tick-job.startTick,remainingTicks=math.max(0,job.endTick-game.tick),liveFactoryVerified=false}
end
function M.cancel(force,id)
 local job=job_for(force,id)
 if not job.result then finish(job,'cancelled') end
 return job.result
end
function M.start(a)
 local real=owner(a.force,a.actor)
 local source=game.surfaces[a.surface]
 if not source or source.name:sub(1,#PREFIX)==PREFIX then error('Choose the real source surface',0) end
 -- Platform arrivals, asteroid spawning and the hub require a platform-specific
 -- fixture. Do not claim those effects from a ground lab.
 if source.platform then error('Platform trials need a native platform fixture; ground labs cannot validate collectors or platform logistics',0) end
 if not number(a.seconds,10,120) or not number(a.warmupSeconds,0,30) then error('Trial duration must be 10..120 seconds, warmup 0..30',0) end
 local s=state()
 if type(a.idempotencyKey)~='string' or #a.idempotencyKey~=64 or not a.idempotencyKey:match('^[a-f0-9]+$') then error('Invalid trial request key',0) end
 for id,existing in pairs(s.jobs) do
  if existing.owner==real.name and existing.key==a.idempotencyKey then return M.read(real.name,id) end
 end
 local running=0
 for _,job in pairs(s.jobs) do
  if not job.result then
   running=running+1
   if job.owner==real.name then error('A sandbox trial is already running for this force',0) end
  end
 end
 if running>=2 then error('Two sandbox trials are already running; wait for completion',0) end
 if type(a.designId)~='string' or not a.designId:match('^[a-f0-9]+$') or #a.designId~=64 then error('Invalid saved design',0) end
 if type(a.blueprint)~='string' or #a.blueprint>128000 then error('Invalid test blueprint',0) end
 local inv=game.create_inventory(1)
 local lab,job
 local ok,err=pcall(function()
  local stack=inv[1]
  if stack.import_stack(a.blueprint)~=0 or not stack.is_blueprint then error('Native blueprint import failed',0) end
  local rows=stack.get_blueprint_entities() or {}
  if #rows==0 or #rows>1000 then error('Test a production module with 1..1000 entities',0) end
  local unlocked={}
  for _,recipe in pairs(real.recipes) do if recipe.enabled then for _,product in pairs(recipe.products) do if product.type=='item' then unlocked[product.name]=true end end end end
  local x1,y1,x2,y2=math.huge,math.huge,-math.huge,-math.huge
  for _,e in ipairs(rows) do
   local p=prototypes.entity[e.name]
   if not p or p.type=='infinity-container' or p.type=='infinity-pipe' or p.type=='electric-energy-interface' then error('Test blueprints must contain ordinary game entities',0) end
   local available=false
   for _,item in pairs(p.items_to_place_this or {}) do if unlocked[item.name] then available=true;break end end
   if not available then error('Test building is not unlocked: '..e.name,0) end
   if e.recipe and (not real.recipes[e.recipe] or not real.recipes[e.recipe].enabled) then error('Test recipe is not unlocked: '..e.recipe,0) end
   x1=math.min(x1,e.position.x-8);y1=math.min(y1,e.position.y-8);x2=math.max(x2,e.position.x+8);y2=math.max(y2,e.position.y+8)
  end
  if x2-x1>128 or y2-y1>128 then error('Test a compact module within 128 by 128 tiles; test long world routes separately',0) end
  local bounds={{math.floor(x1),math.floor(y1)},{math.ceil(x2),math.ceil(y2)}}
  local test= s.forces[real.index] and game.forces[s.forces[real.index]]
  if not test then
   local name=PREFIX..real.index
   if game.forces[name] then error('Test force name is occupied; no existing force will be changed',0) end
   test=game.create_force(name);s.forces[real.index]=name
  end
  if #test.players>0 then error('The test force has players; leave it before running a new trial',0) end
  test.copy_from(real);test.research_queue={}
  s.sequence=s.sequence+1
  local id=tostring(s.sequence)
  local surfaceName=PREFIX..real.index..'-'..id
  if game.surfaces[surfaceName] then error('Test surface name is occupied',0) end
  lab=game.create_surface(surfaceName,{default_enable_all_autoplace_controls=false,autoplace_settings={entity={treat_missing_as_default=false},tile={treat_missing_as_default=false},decorative={treat_missing_as_default=false}}})
  lab.generate_with_lab_tiles=true;lab.ignore_surface_conditions=false;lab.freeze_daytime=source.freeze_daytime;lab.daytime=source.daytime
  lab.override_pollution_type={};lab.peaceful_mode=true;lab.solar_power_multiplier=source.solar_power_multiplier
  for name in pairs(prototypes.surface_property) do lab.set_property(name,source.get_property(name)) end
  for _,f in pairs(game.forces) do f.set_surface_hidden(lab,true) end
  lab.request_to_generate_chunks({0,0},3);lab.force_generate_chunk_requests()
  -- Keep blueprint coordinates: native cursor placement otherwise recenters it.
  local ghost=stack.build_blueprint{surface=lab,force=test,position={0,0},build_mode=defines.build_mode.normal,skip_fog_of_war=false}
  local delta
  local placed={}
  for _,e in pairs(ghost) do if e.valid and e.type=='entity-ghost' then placed[key(e.ghost_name,e.position)]=true end end
  for _,g in pairs(ghost) do
   if g.valid and g.type=='entity-ghost' and g.ghost_name==rows[1].name then
    local d={x=g.position.x-rows[1].position.x,y=g.position.y-rows[1].position.y}
    local all=true
    for _,e in ipairs(rows) do if not placed[key(e.name,{x=e.position.x+d.x,y=e.position.y+d.y})] then all=false;break end end
    if all then delta=d;break end
   end
  end
  if not delta then error('Native blueprint could not be built completely in the test lab',0) end
  -- Native build gives us its exact translation before optionally cloning context.
  for _,e in pairs(ghost) do if e.valid then e.destroy() end end
  bounds={{bounds[1][1]+delta.x,bounds[1][2]+delta.y},{bounds[2][1]+delta.x,bounds[2][2]+delta.y}}
  if a.context then
   if not a.position or not number(a.position.x,-1000000,1000000) or not number(a.position.y,-1000000,1000000) then error('Context needs a real world offset',0) end
   local anchor=a.anchor or rows[1].position
   local dx,dy=anchor.x-rows[1].position.x,anchor.y-rows[1].position.y
   local world={{bounds[1][1]-delta.x+a.position.x+dx,bounds[1][2]-delta.y+a.position.y+dy},{bounds[2][1]-delta.x+a.position.x+dx,bounds[2][2]-delta.y+a.position.y+dy}}
   for x=math.floor(world[1][1]/32),math.floor(world[2][1]/32) do for y=math.floor(world[1][2]/32),math.floor(world[2][2]/32) do
    if not real.is_chunk_charted(source,{x,y}) then error('Explore context chunk ('..x..','..y..') on '..source.name..' before cloning it',0) end
   end end
   local context=source.find_entities_filtered{area=world,limit=2001}
   if #context>2000 then error('Context exceeds 2000 entities; test a smaller module',0) end
   for _,e in pairs(context) do if e.force~=real and e.force.name~='neutral' then error('Context contains entities owned by another force',0) end end
   source.clone_area{source_area=world,destination_area=bounds,destination_surface=lab,destination_force=test,clone_tiles=true,clone_entities=true,clone_decoratives=false,clear_destination_entities=true,expand_map=true}
  end
  ghost=stack.build_blueprint{surface=lab,force=test,position={0,0},build_mode=defines.build_mode.normal,skip_fog_of_war=false,raise_built=true}
  for _,e in pairs(lab.find_entities_filtered{type='tile-ghost'}) do e.silent_revive{raise_revive=true} end
  for _,g in pairs(ghost) do if g.valid and g.type=='entity-ghost' then
   local _,e=g.silent_revive{raise_revive=true}
   if not e then error('Could not construct test entity '..g.ghost_name,0) end
  end end
  local entities={}
  for i,e in ipairs(rows) do
   entities[i]=lab.find_entity(e.name,{x=e.position.x+delta.x,y=e.position.y+delta.y})
   if not entities[i] or entities[i].force~=test then error('Missing test entity '..i..' '..e.name,0) end
  end
  local inputs,outputs={},{}
  local used={}
  local function ports(sourcePorts,destination,role)
   if type(sourcePorts)~='table' or #sourcePorts>16 then error('Use at most 16 test inputs and outputs',0) end
   for _,p in ipairs(sourcePorts) do
    local e=entities[p.entity]
    if not e then error('Choose an existing blueprint entity index for test endpoints',0) end
    local belt=e.type=='transport-belt' or e.type=='underground-belt'
    if p.lane and (not belt or (p.lane~=1 and p.lane~=2)) then error('Belt lane must be 1 or 2',0) end
    local slot=belt and (p.lane or 'both') or p.name
    local existing=used[p.entity]
    if existing and (existing.role~=role or existing[slot] or (belt and (existing.both or slot=='both'))) then error('Test inputs and outputs must not share an endpoint; use distinct belt lanes for mixed supplies',0) end
    existing=existing or {role=role};existing[slot]=true;used[p.entity]=existing
    if not number(p.perMinute,0.01,1000000) then error('Choose a positive endpoint rate up to 1000000/min',0) end
    if p.kind=='item' then
     if not prototypes.item[p.name] or (e.type~='container' and e.type~='logistic-container' and e.type~='transport-belt' and e.type~='underground-belt') then error('Item endpoints must be ordinary or logistic chests or belt segments',0) end
    elseif p.kind=='fluid' then
     if not prototypes.fluid[p.name] or (e.type~='pipe' and e.type~='storage-tank') or e.fluids_count~=1 then error('Fluid endpoints must be pipes or tanks with one fluidbox',0) end
    else error('Choose item or fluid endpoint',0) end
    if p.kind=='fluid' and p.temperature and not number(p.temperature,prototypes.fluid[p.name].default_temperature,prototypes.fluid[p.name].max_temperature) then error('Invalid fluid temperature',0) end
    destination[#destination+1]={entity=e,index=p.entity,lane=p.lane,name=p.name,kind=p.kind,perMinute=p.perMinute,temperature=p.temperature or (p.kind=='fluid' and prototypes.fluid[p.name].default_temperature or nil),credit=0,supplied=0,delivered=0}
   end
  end
  ports(a.inputs or {},inputs,'input');ports(a.outputs or {},outputs,'output')
  local mode=a.mode or 'production'
  if mode~='production' and mode~='transport' and mode~='robot-deployment' then error('Choose production, transport or robot-deployment mode',0) end
  if #outputs==0 and mode~='robot-deployment' then error('Declare at least one output and its target rate',0) end
  if mode=='robot-deployment' and a.context then error('Use a standalone controller design without existing-world context for robot tests',0) end
  local seconds=a.seconds
  for _,out in ipairs(outputs) do
   out.batch=1
   if out.kind=='item' and mode=='production' then for _,e in ipairs(entities) do
    if e.type=='assembling-machine' or e.type=='furnace' then
     local recipe=e.get_recipe()
     for _,p in pairs(recipe and recipe.products or {}) do if p.name==out.name and p.type=='item' then out.batch=math.max(out.batch,p.amount or p.amount_max or 1) end end
    end
   end end
   if mode=='production' then for _,input in ipairs(inputs) do
    if input.name==out.name and input.kind==out.kind then error('Do not supply the measured product in a production test; use transport mode to test a delivery line',0) end
   end end
   -- Observe at least three expected units for slow recipes; very low-rate
   -- products need a longer fixture than this bounded multiplayer trial.
   seconds=math.min(120,math.max(seconds,math.ceil(180*out.batch/out.perMinute)))
  end
  if a.power~='provided' and a.power~='design' then error('Choose provided or design power',0) end
  if a.power=='provided' then lab.create_global_electric_network() end
  local powerPosition=a.powerPosition or {x=bounds[1][1]+2,y=bounds[1][2]+2}
  if a.powerPosition then powerPosition={x=a.powerPosition.x+delta.x,y=a.powerPosition.y+delta.y} end
  local supply=lab.create_entity{name='electric-energy-interface',force=test,position=powerPosition}
  if not supply then error('Test power source is blocked; choose powerPosition near a planned pole',0) end
  supply.electric_buffer_size=1000000000;supply.energy=1000000000;supply.power_production=1000000000
  local warmup=math.floor((mode=='robot-deployment' and math.max(30,a.warmupSeconds) or a.warmupSeconds)*60)
  local robot=mode=='robot-deployment' and robotTrial.setup(a.robots,entities,lab) or nil
  if robot then seconds=math.max(seconds,30) end
  job={id=id,key=a.idempotencyKey,owner=real.name,designId=a.designId,mode=mode,source=source.name,context=a.context==true,power=a.power,surface=lab,entities=entities,
   robot=robot,inputs=inputs,outputs=outputs,startTick=game.tick,sampleStart=game.tick+warmup,endTick=game.tick+warmup+math.floor(seconds*60),warmup=warmup,status='running'}
  s.jobs[id]=job
 end)
 inv.destroy()
 if not ok then cleanup(lab);error(err,0) end
 -- Retain only a small history; active jobs are never evicted.
 local completed={} for id,j in pairs(s.jobs) do if j.result then completed[#completed+1]=tonumber(id) end end
 table.sort(completed)
 while #completed>16 do s.jobs[tostring(table.remove(completed,1))]=nil end
 return M.read(real.name,job.id)
end
events.on_event(defines.events.on_tick,function()
 for _,job in pairs(state().jobs) do if not job.result then
  local ok,err=pcall(function()
   if not job.surface or not job.surface.valid then error('Test surface was removed',0) end
   for _,p in ipairs(job.inputs) do feed(p) end
   for _,p in ipairs(job.outputs) do
    local count=remove(p)
    if game.tick>job.sampleStart then p.delivered=p.delivered+count end
   end
   if job.robot then
    if robotTrial.tick(job.robot,game.tick>=job.sampleStart) then job.sampleEnd=game.tick;finish(job,'done')
    elseif game.tick>job.endTick+60 then error('Robot controller test did not finish within its fixture window',0) end
   elseif game.tick>=job.endTick then job.sampleEnd=game.tick;finish(job,'done') end
  end)
  if not ok then
   local finalized=pcall(finish,job,'error',tostring(err):match('^[^\n]*'))
   if not finalized then
    -- A mod-invalidated entity or failed cleanup must never crash multiplayer.
    job.result={operation='test_blueprint',id=job.id,designId=job.designId,status='error',passed=false,error=tostring(err):match('^[^\n]*'),liveFactoryVerified=false}
    cleanup(job.surface)
    job.entities=nil;job.surface=nil;job.inputs=nil;job.outputs=nil;job.robot=nil
   end
  end
 end end
end)
remote.add_interface('facmandu-toby-sandbox',{start=M.start,read=M.read,cancel=M.cancel,features=function() return {robotDeployment=true} end})
return M
