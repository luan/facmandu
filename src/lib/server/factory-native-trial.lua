local events=require('events').scope('layout-runner')
local sandbox=require('sandbox')
local build=require('pack')
local payload=helpers.json_to_table(require('request'))
local function write(value)
 helpers.write_file('layout-trial.json',helpers.table_to_json(value),false)
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
   local started=sandbox.start(trial,120,256)
   storage.job=started.id
   helpers.write_file('layout-progress.json',helpers.table_to_json(started),false)
  elseif e.tick%60==0 then
   local result=sandbox.read(payload.request.force,storage.job)
   if result.status~='running' then
    write({pack=storage.pack,result=result});storage.finished=true
   else helpers.write_file('layout-progress.json',helpers.table_to_json(result),false) end
  end
 end)
 if not ok then
  write({error=tostring(err):match('^[^\n]*')});storage.finished=true
 end
end)
