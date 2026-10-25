local events=require('events').scope('layout-runner')
local sandbox=require('sandbox')
local build=require('pack')
local build_plan=require('plan-pack')
local inserter_rules=require('inserter-rules')
local payload=helpers.json_to_table(require('request'))
local startup=require('startup')
local function recycling_stats(job)
 local stats=job.entities[1].force.get_item_production_statistics(job.surface)
 local products={};for _,name in ipairs(payload.recycling.products) do products[name]=stats.get_input_count(name) end
 return {consumed=stats.get_output_count(payload.recycling.ingredient),products=products,tick=game.tick}
end
sandbox.before_finish=function(job)
 if payload.recycling and storage.recycling_start and job.entities then
  local after=recycling_stats(job);local before=storage.recycling_start
  local products={};for name,value in pairs(after.products) do products[name]=value-before.products[name] end
  storage.recycling_proof={consumed=after.consumed-before.consumed,products=products,ticks=after.tick-before.tick}
 end
end
local function write(value)
 helpers.write_file('layout-trial.json',helpers.table_to_json(value),false)
end
local function diagnostics(job)
 local producers,fluids,connections,loaders,controls={},{},{},{},{}
 local statuses={} for name,value in pairs(defines.entity_status) do statuses[value]=name end
 for _,e in ipairs(job.entities or {}) do if e.valid then
  if e.type=='assembling-machine' or e.type=='furnace' or e.type=='pump' then
   local b=e.get_control_behavior()
   if b and (e.type=='pump' or b.circuit_enable_disable or b.circuit_read_contents) then
    local condition=b.circuit_condition
    local definition=condition and (condition.condition or condition)
    local signal=definition and definition.first_signal
    local network=(b.get_circuit_network(defines.wire_connector_id.circuit_red) or b.get_circuit_network(defines.wire_connector_id.circuit_green))
    controls[#controls+1]={position=e.position,condition=condition,disabled=b.disabled,
     signal=signal and network and network.get_signal(signal) or 0,fluids=e.get_fluid_contents()}
   end
  end
  if e.type=='assembling-machine' or e.type=='furnace' then
   local recipe=e.get_recipe()
   local key=e.name..'/'..(recipe and recipe.name or '')
   local row=producers[key] or {machine=e.name,recipe=recipe and recipe.name,count=0,minSpeed=e.crafting_speed,maxSpeed=e.crafting_speed,statuses={}}
   row.count=row.count+1
   row.minSpeed=math.min(row.minSpeed,e.crafting_speed);row.maxSpeed=math.max(row.maxSpeed,e.crafting_speed)
   local status=statuses[e.status] or tostring(e.status);row.statuses[status]=(row.statuses[status] or 0)+1
   producers[key]=row
   if not connections[key] then
    local boxes={}
    for index=1,e.fluids_count do
     local filter=e.get_fluid_filter(index)
     local neighbors={}
     for _,p in pairs(e.get_fluid_box_pipe_connections(index) or {}) do
      neighbors[#neighbors+1]={position=p.position,target=p.target and p.target.position,segment=p.target and p.target.has_fluid_segment(p.target_fluidbox_index) and p.target.get_fluid_segment_id(p.target_fluidbox_index) or nil,fluid=p.target and p.target.has_fluid_segment(p.target_fluidbox_index) and p.target.get_fluid_segment_fluid(p.target_fluidbox_index) or nil}
     end
     boxes[#boxes+1]={filter=filter and filter.name,segment=e.has_fluid_segment(index) and e.get_fluid_segment_id(index) or nil,fluid=e.get_fluid(index),neighbors=neighbors}
    end
    connections[key]={position=e.position,boxes=boxes}
   end

  end
  if e.type=='loader-1x1' and #loaders<8 then
   local contents={}
   for i=1,2 do contents[i]=e.get_transport_line(i).get_contents() end
   loaders[#loaders+1]={name=e.name,position=e.position,direction=e.direction,mode=e.loader_type,container=e.loader_container and e.loader_container.name,status=statuses[e.status],contents=contents}
  end
  if e.type=='assembling-machine' or e.type=='furnace' or e.type=='pipe' or e.type=='pipe-to-ground' then
   for name,amount in pairs(e.get_fluid_contents()) do fluids[name]=(fluids[name] or 0)+amount end
  end
 end end
 return {tick=game.tick,producers=producers,storedFluids=fluids,connections=connections,loaders=loaders,controls=controls}
end
local function verify_fluids(job,pack)
 local segments,networks={},{}
 local function key(p) return math.floor(p.x)..','..math.floor(p.y) end
 for _,e in ipairs(job.entities or {}) do if e.valid and (e.type=='assembling-machine' or e.type=='furnace') then
  local recipe=e.get_recipe();local model=recipe and pack.recipes[recipe.name]
  local expected,required,connected={},{},{}
  for _,port in ipairs(model and model.fluid_connections or {}) do expected[key{x=e.position.x+port.position.x,y=e.position.y+port.position.y}]=port.name end
  for _,list in ipairs{model and model.fluid_inputs or {},model and model.fluid_outputs or {}} do
   for _,port in ipairs(list) do required[port.name]=true end
  end
  for index=1,e.fluids_count do
   for _,port in pairs(e.get_fluid_box_pipe_connections(index) or {}) do
    local target=port.target
    local name=target and expected[key(target.position)]
    if name and target.has_fluid_segment(port.target_fluidbox_index) then
     local id=target.get_fluid_segment_id(port.target_fluidbox_index)
     if model.disposal and model.disposal.gate then
      assert(target.type=='pump','Disposal input is missing its overflow gate')
      for _,link in pairs(target.get_fluid_box_pipe_connections(port.target_fluidbox_index)) do if link.target and link.target~=e and link.target.has_fluid_segment(link.target_fluidbox_index) then id=link.target.get_fluid_segment_id(link.target_fluidbox_index) end end
     end
     assert(not segments[id] or segments[id]==name,'Fluid network joins '..name..' to '..tostring(segments[id])..' at '..e.name)
     assert(not networks[name] or networks[name]==id,'Disconnected native '..name..' networks at '..e.name)
     networks[name]=id;segments[id]=name;connected[name]=true
    end
   end
  end
  for name in pairs(required) do assert(connected[name],'Missing native '..name..' connection at '..e.name) end
 end end
 for _,e in ipairs(job.entities or {}) do if e.valid and e.type=='pump' then
  local condition=e.get_control_behavior().circuit_condition;condition=condition.condition or condition
  local name=condition.first_signal.name
  local forward=({[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}})[e.direction]
  local inlet,outlet=false,false
  for _,link in pairs(e.get_fluid_box_pipe_connections(1)) do local target=link.target;if target then
   local dot=(target.position.x-e.position.x)*forward[1]+(target.position.y-e.position.y)*forward[2]
   if dot<0 and target.has_fluid_segment(link.target_fluidbox_index) then
    inlet=networks[name]==target.get_fluid_segment_id(link.target_fluidbox_index)
   elseif dot>0 and target.type=='furnace' then outlet=true end
  end end
  assert(inlet and outlet,'Overflow pump must connect the correct supply to its disposal furnace: '..name)
 end end
end
-- Supply the surrounding network, never intermediate items, in robot-fed trials.
local function provide_logistics(job,pack)
 if not payload.request.logistics then return end
 local consumed={}
 for _,line in ipairs(pack.plan and pack.plan.lines or {}) do for _,part in ipairs(line.ingredients) do if part.type=='item' then consumed[part.name]=true end end end
 local internal=false
 for _,line in ipairs(pack.plan and pack.plan.lines or {}) do for _,part in ipairs(line.products) do if part.type=='item' and consumed[part.name] then internal=true end end end
 if not internal then for _,e in ipairs(job.entities) do if e.type=='logistic-container' and e.prototype.logistic_mode=='active-provider' then internal=true;break end end end
 if not internal then return end
 local surface,force=job.surface,job.entities[1].force
 local left,top,right,bottom=math.huge,math.huge,-math.huge,-math.huge
 for _,e in ipairs(job.entities) do left=math.min(left,e.position.x);top=math.min(top,e.position.y);right=math.max(right,e.position.x);bottom=math.max(bottom,e.position.y) end
 local radius=prototypes.entity.roboport.logistic_radius
 local count=0;storage.logistics_ports={}
 for x=left-4,right+radius,radius do for y=top-4,bottom+radius,radius do
  local position=surface.find_non_colliding_position('roboport',{x=x,y=y},12,1)
  if position then
   local port=assert(surface.create_entity{name='roboport',position=position,force=force})
   port.get_inventory(defines.inventory.roboport_robot).insert{name='logistic-robot',count=20}
   port.energy=1000000000;storage.logistics_ports[#storage.logistics_ports+1]=port
   count=count+1
  end
 end end
 assert(count>0,'No room for the isolated logistics network')
 storage.provided_logistics=true
end
local function verify_logistics(job)
 local network
 for _,e in ipairs(job.entities) do if e.type=='logistic-container' then
  local current=job.surface.find_logistic_network_by_position(e.position,e.force)
  assert(current and (not network or current.network_id==network),'Isolated logistics network does not cover every production chest')
  network=current.network_id
 end end
end
local function context()
 local c=payload.context
 for name,version in pairs(c.mods) do assert(script.active_mods[name]==version,'Native mod version changed: '..name) end
 for name in pairs(script.active_mods) do assert(name=='facmandu-layout-validator' or c.mods[name],'Unexpected native mod: '..name) end
 for name,value in pairs(c.runtimeSettings) do
  local setting=assert(settings.global[name],'Runtime setting changed: '..name)
  if helpers.table_to_json({value=setting.value})~=helpers.table_to_json({value=value}) then settings.global[name]={value=value} end
 end
 local force=game.forces[payload.request.force] or game.create_force(payload.request.force)
 for name,t in pairs(force.technologies) do
  local saved=assert(c.technologies[name],'Technology context changed: '..name)
  if t.level~=saved.level then t.level=saved.level end
  if t.researched~=saved.researched then t.researched=saved.researched end
 end
 local count=0
 for name in pairs(c.recipes.exceptions) do assert(force.recipes[name],'Recipe context changed: '..name) end
 for name,r in pairs(force.recipes) do
  local enabled=c.recipes.defaultEnabled
  if c.recipes.exceptions[name] then enabled=not enabled end
  if r.enabled~=enabled then r.enabled=enabled end
  count=count+1
 end
 assert(count==c.recipes.count,'Recipe catalog changed')
 for name,value in pairs(c.modifiers) do if force[name]~=value then force[name]=value end end
 local surface=game.surfaces[payload.request.surface] or game.create_surface(payload.request.surface,{default_enable_all_autoplace_controls=false})
 for name,value in pairs(c.properties) do surface.set_property(name,value) end
 surface.daytime=c.daytime;surface.freeze_daytime=c.freezeDaytime;surface.solar_power_multiplier=c.solarPowerMultiplier
 return build(payload.request,function(request,force,surface,entity,pack,crafters)
  return build_plan(request,force,surface,entity,pack,crafters,payload.plan)
 end,inserter_rules)
end
events.on_event(defines.events.on_tick,function(e)
 if storage.finished then return end
 local ok,err=pcall(function()
  for _,port in ipairs(storage.logistics_ports or {}) do if port.valid then port.energy=1000000000 end end
  if not storage.started then
   storage.started=true
   helpers.write_file('layout-progress.json',helpers.table_to_json({id=payload.designId,status='running',phase='context'}),false)
   storage.pack=context()
   local trial=payload.test
   trial.blueprint=payload.blueprint;trial.designId=payload.designId;trial.idempotencyKey=payload.designId
   trial.anchor=payload.anchor
   if payload.startupSeconds then trial.warmupSeconds=0 end
   local started=sandbox.start(trial,300,256)
   storage.job=started.id
   local job=assert(storage.toby_trials.jobs[storage.job])
   provide_logistics(job,storage.pack)
   for _,item in ipairs(trial.startupItems or {}) do
    local machine=assert(job.entities[item.entity],'Missing startup-stock machine')
    local inventory=assert(machine.get_inventory(defines.inventory.crafter_input),'Startup stock requires a crafting input inventory')
    assert(inventory.insert{name=item.name,count=item.count}==item.count,'Cannot supply declared startup stock: '..item.name)
   end
   if payload.startupSeconds then
    storage.startup={history={},deadline=job.startTick+payload.startupSeconds*60,sampleTicks=payload.measurementSeconds*60}
    job.endTick=storage.startup.deadline+storage.startup.sampleTicks
   end
   for _,wanted in ipairs(payload.settings or {}) do
    local entity=assert(job.entities[wanted.index],'Missing configured entity')
    if wanted.items then
     local inventory=assert(entity.get_module_inventory(),'Missing native module inventory')
     for _,request in ipairs(wanted.items) do for _,position in ipairs(request.items.in_inventory) do
      assert(position.inventory==defines.inventory.crafter_modules,'Unexpected module inventory')
      local stack=inventory[position.stack+1]
      stack.set_stack{name=request.id.name,quality=request.id.quality or 'normal',count=position.count or 1}
      assert(stack.valid_for_read and stack.name==request.id.name and stack.quality.name==(request.id.quality or 'normal'),'Native module configuration changed')
     end end
     local proxy=entity.item_request_proxy;if proxy then proxy.destroy() end
    end
    if wanted.control then
     local b=assert(entity.get_control_behavior(),'Missing native machine controls')
     assert(wanted.control.read_contents==nil or b.circuit_read_contents==wanted.control.read_contents,'Native contents reading changed')
     assert(b.circuit_enable_disable==wanted.control.circuit_enabled,'Native circuit enable control changed')
     if wanted.control.include_in_crafting~=nil then assert(b.include_in_crafting==wanted.control.include_in_crafting,'Native in-crafting stock reading changed') end
     if wanted.control.circuit_read_hand_contents~=nil then assert(b.circuit_read_hand_contents==wanted.control.circuit_read_hand_contents,'Native inserter hand reading changed') end

     assert((b.get_circuit_network(defines.wire_connector_id.circuit_red) or b.get_circuit_network(defines.wire_connector_id.circuit_green)),'Native fluid-control circuit wire is missing')
     local expected=wanted.control.circuit_condition
     if expected then
      local actual=b.circuit_condition
      actual=actual.condition or actual
      assert(actual.comparator==expected.comparator and actual.constant==expected.constant and actual.first_signal.name==expected.first_signal.name,'Native fluid-control condition changed')
     end
    end
    for _,pair in ipairs{{wanted.pickup,'pickup_position'},{wanted.drop,'drop_position'}} do if pair[1] then
     local actual=entity[pair[2]]
     assert(math.abs(actual.x-entity.position.x-pair[1].x)<0.000001 and math.abs(actual.y-entity.position.y-pair[1].y)<0.000001,'Native inserter geometry changed for '..entity.name..' '..wanted.index..' '..pair[2]..': expected '..pair[1].x..','..pair[1].y..', got '..(actual.x-entity.position.x)..','..(actual.y-entity.position.y))
    end end
    if wanted.requests and entity.type=='logistic-container' and entity.prototype.logistic_mode=='storage' then
     local actual=entity.storage_filter
     local name=actual and actual.name and (type(actual.name)=='string' and actual.name or actual.name.name)
     assert(name==wanted.requests.sections[1].filters[1].name,'Native storage filter changed')
    elseif wanted.requests then
     local sections=assert(entity.get_logistic_sections(),'Missing native logistic sections')
     if wanted.requests.request_from_buffers~=nil then assert(entity.request_from_buffers==wanted.requests.request_from_buffers,'Native buffer request setting changed') end
     for _,section in ipairs(wanted.requests.sections) do
      local actual=assert(sections.get_section(section.index),'Missing native logistic section')
      for _,filter in ipairs(section.filters) do
       local got=actual.filters[filter.index]
       assert(got and got.value and got.value.name==filter.name and (got.min or 0)==filter.count,'Native logistic filter changed')
      end
     end
    end
    if wanted.outputPriority then assert(entity.splitter_output_priority==wanted.outputPriority,'Native splitter priority changed') end
    if wanted.filters then
     assert(entity.use_filters==wanted.useFilters,'Native inserter filter mode changed')
     for _,filter in ipairs(wanted.filters) do local actual=entity.get_filter(filter.index);assert(actual and actual.name==filter.name,'Native inserter filter changed') end
    end
    if wanted.stackSize then assert(entity.inserter_stack_size_override==wanted.stackSize,'Native inserter stack size changed') end
    if wanted.bar then assert(entity.get_inventory(defines.inventory.chest).get_bar()==wanted.bar+1,'Native inventory limit changed') end
   end
   verify_fluids(job,storage.pack)
   storage.settings_verified=true
   helpers.write_file('layout-geometry.json',helpers.table_to_json(diagnostics(job)),false)
   helpers.write_file('layout-progress.json',helpers.table_to_json(started),false)
  elseif e.tick%60==0 then
   local job=storage.toby_trials.jobs[storage.job]
   if payload.recycling and not storage.recycling_start and job and job.entities and game.tick>=job.sampleStart then storage.recycling_start=recycling_stats(job) end
   local rates
   if not storage.loaders_verified and job and job.entities and game.tick>=job.startTick+60 then
    for _,entity in ipairs(job.entities) do if entity.type=='loader-1x1' then
     assert(entity.loader_container and entity.loader_container.valid,'Loader is not connected to its machine or chest at '..entity.position.x..','..entity.position.y)
    end end
    storage.loaders_verified=true
   end
   if storage.provided_logistics and not storage.logistics_verified and job and job.entities and game.tick>=job.startTick+300 then verify_logistics(job);storage.logistics_verified=true end
   if storage.startup then
    local ready;ready,rates=startup(storage.startup.history,game.tick,job.outputs,payload.request.logistics~=nil)
    if ready or game.tick>=storage.startup.deadline then
     job.sampleStart=game.tick;job.warmup=game.tick-job.startTick;job.endTick=game.tick+storage.startup.sampleTicks
     for _,p in ipairs(job.outputs) do p.delivered=0 end
     storage.startup=nil
    end
   end
   if job and job.entities and ((game.tick>=job.sampleStart and game.tick<job.sampleStart+60) or game.tick>=job.endTick-60) then
    storage.diagnostics=storage.diagnostics or {}
    storage.diagnostics[#storage.diagnostics+1]=diagnostics(job)
   end
   local result=sandbox.read(payload.request.force,storage.job)
   if result.status~='running' then
    if storage.provided_logistics then assert(storage.logistics_verified,'Isolated logistics coverage was not verified');result.note=result.note..' Ordinary robots and connected roboport coverage were supplied by the isolated fixture.' end
    result.startupItems=payload.test.startupItems
    if #(payload.test.startupItems or {})>0 then result.note=result.note..' Declared startup stock was supplied once to prime local recycling buffers.' end
    result.recyclingProof=storage.recycling_proof;result.diagnostics=storage.diagnostics;result.settingsVerified=storage.settings_verified
    write({pack=storage.pack,result=result});storage.finished=true
   else
    if payload.startupSeconds then result.phase=storage.startup and 'startup' or 'measurement';result.outputs=storage.startup and rates or nil end
    helpers.write_file('layout-progress.json',helpers.table_to_json(result),false)
   end
  end
 end)
 if not ok then
  write({error=tostring(err):match('^[^\n]*')});storage.finished=true
 end
end)
