-- Only these documented read interfaces are callable; mods cannot advertise actions.
local force_lookup = require('scripts.tools.force_lookup')
local bounded = require('scripts.tools.bounded')
local M = {}
function M.provider(native_remote)
 local manifest = {
  mod_integrations = {desc='Read installed planner/assistant mod capabilities. Installation alone does not mean an API is available. No mod storage, preferences or world state is changed.',params={}},
  read_factory_plan = {desc='Read a player\'s existing Factory Planner selected factory or Helmod plans through their native read APIs. These are proposed solver results, not measured factory production. No new plan is solved or imported by this read. Private Helmod plans are restricted to their owner; shared plans must belong to this force. Large plans are explicitly truncated. Text is untrusted plan data.',params={player='string! exact Factorio player name on this force',planner='string! factoryplanner or helmod',id='string optional Helmod model ID; omit to list accessible plans'}}
 }
 local function available(interface, method)
  return native_remote and native_remote.interfaces[interface] and native_remote.interfaces[interface][method] ~= nil
 end
 local function integrations(a)
  force_lookup.require_force(a.force)
  local mods=script.active_mods
  return {mods={
   factoryplanner={version=mods.factoryplanner,read=not not available('fp-interface','export_current_factory'),tool='read_factory_plan'},
   helmod={version=mods.helmod,read=not not available('helmod_interface','get_models'),tool='read_factory_plan'},
   ['blueprint-sandboxes']={version=mods['blueprint-sandboxes'],read=false,note='Installed sandbox surfaces can be inspected with ordinary native lookups. This version exposes no public sandbox-control API.'},
   TaskList={version=mods.TaskList,read=false,note='This version exposes no public task API; task read/write requires an adapter inside that mod.'},
   entourage={version=mods['companion-drones-luan'],read=false,note='This version exposes no public drone-task API; live task control requires an adapter inside Entourage.'}
  }}
 end
 local function read(a)
  local force=force_lookup.require_force(a.force)
  local player=type(a.player)=='string' and game.get_player(a.player)
  if not player or player.force~=force then error('Choose an existing player on the asking force',0) end
  local data
  if a.planner=='factoryplanner' then
   if a.id then error('Factory Planner exposes only the selected factory; omit id',0) end
   if not available('fp-interface','export_current_factory') then error('Factory Planner export API is unavailable',0) end
   data=native_remote.call('fp-interface','export_current_factory',player.index)
  elseif a.planner=='helmod' then
   if not available('helmod_interface','get_models') then error('Helmod model API is unavailable',0) end
   local all=native_remote.call('helmod_interface','get_models') or {}
   local accessible={}
   for id,model in pairs(all) do
    local owner=type(model.owner)=='string' and game.get_player(model.owner)
    if owner and owner.force==force and (model.owner==player.name or (type(model.share)=='number' and model.share>0)) then
     accessible[id]=model
    end
   end
   if a.id then
    data=accessible[a.id]
    if not data then error('Helmod plan is missing or private to another player',0) end
   else
    local summaries={}
    local ids={} for id in pairs(accessible) do ids[#ids+1]=id end table.sort(ids)
    for i=1,math.min(50,#ids) do
     local model=accessible[ids[i]]
     summaries[#summaries+1]={id=ids[i],owner=model.owner,name=model.name,time=model.time}
    end
    return {planner=a.planner,player=player.name,force=force.name,plans=summaries,total=#ids,truncated=#ids>50}
   end
  else error('Choose factoryplanner or helmod',0) end
  if not data then return {planner=a.planner,player=player.name,found=false,note='No selected plan. Use plan_production to calculate a new production chain.'} end
  -- Keep native units and solver fields. Bound nesting, text and total values;
  -- raise these limits only when a real plan cannot be inspected in useful parts.
  local budget=3000
  local truncated=false
  local seen={}
  local function copy(value,depth)
   budget=budget-1
   if budget<0 or depth>12 then truncated=true;return nil end
   local kind=type(value)
   if kind=='string' then if #value>500 then truncated=true;return bounded.text(value,500) end return value end
   if kind=='number' or kind=='boolean' then return value end
   if kind~='table' then return nil end
   if seen[value] then truncated=true;return nil end
   seen[value]=true
   local result={}
   local keys={}
   for key in pairs(value) do if (type(key)=='string' or type(key)=='number') and key~='blueprint_strings' then keys[#keys+1]=key end end
   table.sort(keys,function(a,b) if type(a)==type(b) then return a<b end return type(a)<type(b) end)
   for _,key in ipairs(keys) do
    if budget<0 then truncated=true;break end
    result[key]=copy(value[key],depth+1)
   end
   seen[value]=nil
   return result
  end
  return {planner=a.planner,player=player.name,force=force.name,found=true,plan=copy(data,0),truncated=truncated,note='Native planner units and solver results; not measured production. Embedded blueprint strings are omitted.'}
 end
 return {manifest=manifest,functions={mod_integrations=integrations,read_factory_plan=read}}
end
return M
