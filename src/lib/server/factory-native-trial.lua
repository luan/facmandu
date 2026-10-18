local events=require('events').scope('layout-runner')
local sandbox=require('sandbox')
local build=require('pack')
local build_plan=require('plan-pack')
local inserter_rules=require('inserter-rules')
local payload=helpers.json_to_table(require('request'))
local function write(value)
 helpers.write_file('layout-trial.json',helpers.table_to_json(value),false)
end
local function diagnostics(job)
 local producers,fluids,connections,loaders={},{},{},{}
 local statuses={} for name,value in pairs(defines.entity_status) do statuses[value]=name end
 for _,e in ipairs(job.entities or {}) do if e.valid then
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
 return {tick=game.tick,producers=producers,storedFluids=fluids,connections=connections,loaders=loaders}
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
     assert(not segments[id] or segments[id]==name,'Fluid network joins '..name..' to '..tostring(segments[id])..' at '..e.name)
     assert(not networks[name] or networks[name]==id,'Disconnected native '..name..' networks at '..e.name)
     networks[name]=id;segments[id]=name;connected[name]=true
    end
   end
  end
  for name in pairs(required) do assert(connected[name],'Missing native '..name..' connection at '..e.name) end
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
  if not storage.started then
   storage.started=true
   helpers.write_file('layout-progress.json',helpers.table_to_json({id=payload.designId,status='running',phase='context'}),false)
   storage.pack=context()
   local trial=payload.test
   trial.blueprint=payload.blueprint;trial.designId=payload.designId;trial.idempotencyKey=payload.designId
   trial.anchor=payload.anchor
   local started=sandbox.start(trial,300,256)
   storage.job=started.id
   local job=assert(storage.toby_trials.jobs[storage.job])
   for _,wanted in ipairs(payload.settings or {}) do
    local entity=assert(job.entities[wanted.index],'Missing configured entity')
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
    if wanted.bar then assert(entity.get_inventory(defines.inventory.chest).get_bar()==wanted.bar+1,'Native inventory limit changed') end
   end
   verify_fluids(job,storage.pack)
   storage.settings_verified=true
   helpers.write_file('layout-geometry.json',helpers.table_to_json(diagnostics(job)),false)
   helpers.write_file('layout-progress.json',helpers.table_to_json(started),false)
  elseif e.tick%60==0 then
   local job=storage.toby_trials.jobs[storage.job]
   if job and job.entities and ((game.tick>=job.sampleStart and game.tick<job.sampleStart+60) or game.tick>=job.endTick-60) then
    storage.diagnostics=storage.diagnostics or {}
    storage.diagnostics[#storage.diagnostics+1]=diagnostics(job)
   end
   local result=sandbox.read(payload.request.force,storage.job)
   if result.status~='running' then
    result.diagnostics=storage.diagnostics;result.settingsVerified=storage.settings_verified
    write({pack=storage.pack,result=result});storage.finished=true
   else helpers.write_file('layout-progress.json',helpers.table_to_json(result),false) end
  end
 end)
 if not ok then
  write({error=tostring(err):match('^[^\n]*')});storage.finished=true
 end
end)
