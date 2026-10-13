-- Each subsystem retains Factorio's replace/cancel semantics for its own handlers.
-- A shared registration prevents one subsystem from removing another's callback.
local M={}
local registries={}
local function register(api,key,scope,handler)
 local registry=registries[api]
 if not registry then registry={};registries[api]=registry end
 local entry=registry[key]
 if not entry then entry={order={},handlers={}};registry[key]=entry end
 if not entry.handlers[scope] and handler then
  local known=false
  for _,name in ipairs(entry.order) do if name==scope then known=true;break end end
  if not known then entry.order[#entry.order+1]=scope end
 end
 entry.handlers[scope]=handler
 local callback
 if next(entry.handlers) then
  callback=function(event)
   -- Callbacks may unregister scheduled work while this event is being delivered.
   for _,name in ipairs(entry.order) do
    local fn=entry.handlers[name]
    if fn then fn(event) end
   end
  end
 end
 if api=='on_event' or api=='on_nth_tick' then script[api](key,callback)
 else script[api](callback) end
end
function M.scope(name)
 local result={}
 for _,api in ipairs{'on_init','on_load','on_configuration_changed'} do
  result[api]=function(handler) register(api,0,name,handler) end
 end
 for _,api in ipairs{'on_event','on_nth_tick'} do
  result[api]=function(keys,handler)
   if type(keys)=='table' then
    for _,key in pairs(keys) do register(api,key,name,handler) end
   else register(api,keys,name,handler) end
  end
 end
 return result
end
return M
