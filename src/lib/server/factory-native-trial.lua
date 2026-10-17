local events=require('events').scope('layout-runner')
local sandbox=require('sandbox')
local build=require('pack')
local payload=helpers.json_to_table(require('request'))
local function write(value)
 helpers.write_file('layout-trial.json',helpers.table_to_json(value),false)
end
local function diagnostics(job)
 local producers,fluids={},{}
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
  end
  if e.type=='assembling-machine' or e.type=='furnace' or e.type=='pipe' or e.type=='pipe-to-ground' then
   for name,amount in pairs(e.get_fluid_contents()) do fluids[name]=(fluids[name] or 0)+amount end
  end
 end end
 return {tick=game.tick,producers=producers,storedFluids=fluids}
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
 return build(payload.request)
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
   helpers.write_file('layout-progress.json',helpers.table_to_json(started),false)
  elseif e.tick%60==0 then
   local job=storage.toby_trials.jobs[storage.job]
   if job and job.entities and ((game.tick>=job.sampleStart and game.tick<job.sampleStart+60) or game.tick>=job.endTick-60) then
    storage.diagnostics=storage.diagnostics or {}
    storage.diagnostics[#storage.diagnostics+1]=diagnostics(job)
   end
   local result=sandbox.read(payload.request.force,storage.job)
   if result.status~='running' then
    result.diagnostics=storage.diagnostics
    write({pack=storage.pack,result=result});storage.finished=true
   else helpers.write_file('layout-progress.json',helpers.table_to_json(result),false) end
  end
 end)
 if not ok then
  write({error=tostring(err):match('^[^\n]*')});storage.finished=true
 end
end)
