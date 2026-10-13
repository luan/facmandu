-- Reuse native readers so the first useful diagnosis needs one model round.
local locate=require('scripts.tools.locate').functions
local machines=require('scripts.tools.machine_diagnostics').functions
local power=require('scripts.tools.power_diagnostics').functions
local production=require('scripts.tools.production').functions
local buses=require('scripts.tools.bus_discovery').functions
local planning=require('scripts.tools.planning').functions
local force_lookup=require('scripts.tools.force_lookup')
local surface_lookup=require('scripts.tools.surface_lookup')
local M={}
M.manifest={survey_production={desc='Read a product expansion site in one synchronized snapshot: existing built producers, one representative machine with attached supply/output traces, nearby infrastructure and stored supplies, power, recent item rates and candidate matching bus lanes. Reuses the normal bounded native readers. Give exact product and force/surface; optional x/y selects the nearest producer within 96 tiles. Without coordinates chooses the lowest-ID shown producer, not necessarily the bottleneck. Publish the findings before targeted upstream inspection or design. This is read-only; a representative machine, occupied bus or stored stock is not a sustained-delivery proof. Unknown product returns suggestions; no automatic substitution.',params={surface='string! surface name',product='string! exact item or fluid prototype name',x='number optional center x, requires y',y='number optional center y, requires x'}}}
local function read(a)
 local force=force_lookup.require_force(a.force)
 local surface,miss=surface_lookup.find(a.surface)
 if not surface then miss.force=force.name;return miss end
 if surface.platform and surface.platform.force~=force then error('Choose a surface belonging to this force',0) end
 if type(a.product)~='string' or a.product=='' then error('product is required',0) end
 local search={force=force.name,surface=surface.name,product=a.product,ghost=false,limit=6}
 if a.x~=nil or a.y~=nil then
  for _,v in ipairs({a.x or false,a.y or false}) do
   if type(v)~='number' or v~=v or math.abs(v)>1000000 then error('Use finite x and y together',0) end
  end
  search.x=a.x;search.y=a.y;search.radius=96
 end
 local found=locate.find_entities(search)
 local result={force=force.name,surface=surface.name,product=a.product,tick=game.tick,producers=found,
  note='One representative producer, not a whole-factory bottleneck assessment. Each reader retains its bounds; stored inputs and occupied belts are not sustained-delivery proof.'}
 if not found.found then result.found=false;result.reason=found.reason;result.suggestions=found.suggestions;return result end
 result.found=true
 local sections={}
 local function section(name,fn,args)
  local ok,value=pcall(fn,args)
  if ok then result[name]=value else sections[#sections+1]={section=name,error=tostring(value):match('^[^\n]*')} end
 end
 if prototypes.item[a.product] then section('rate',production.item_rate,{force=force.name,surface=surface.name,item=a.product,window='one_minute'}) end
 local candidates=found.entities
 if #candidates==0 then
  -- A real but unused mod prototype can share the player's everyday item name.
  -- Expose actual alternatives; never silently change which product was requested.
  local recipes=planning.planning_recipes{force=force.name,product=a.product}
  result.recipes=recipes
  if recipes.total==0 then
   result.product_resolution_required=true
   result.note='This exact prototype has no shown producers or crafting recipes. Inspect its alternative products before claiming the requested item is absent; the rate belongs only to this exact prototype.'
   local alternatives={}
   for index,name in ipairs(recipes.suggestions or {}) do
    if index>6 then break end
    local other=locate.find_entities{force=force.name,surface=surface.name,product=name,ghost=false,limit=1}
    alternatives[#alternatives+1]={product=name,producers=other.total,truncated=other.truncated,example=(other.entities or {})[1]}
   end
   result.alternatives=alternatives
  end
 end
 table.sort(candidates,function(x,y)
  if a.x then
   local dx=(x.x-a.x)^2+(x.y-a.y)^2;local dy=(y.x-a.x)^2+(y.y-a.y)^2
   if dx~=dy then return dx<dy end
  end
  return (x.unit_number or 0)<(y.unit_number or 0)
 end)
 local selected=candidates[1]
 if selected then
  result.selected={name=selected.name,unit_number=selected.unit_number,x=selected.x,y=selected.y}
  local at={force=force.name,surface=surface.name,x=selected.x,y=selected.y,name=selected.name,unit_number=selected.unit_number}
  section('machine',machines.inspect_machine,at)
  section('power',power.inspect_power_network,at)
  section('nearby',locate.find_entities,{force=force.name,surface=surface.name,x=selected.x,y=selected.y,radius=24,details=true,limit=40})
  if prototypes.item[a.product] then section('buses',buses.find_buses,{force=force.name,surface=surface.name,x=selected.x,y=selected.y,product=a.product,radius=128}) end
 end
 if #sections>0 then result.errors=sections end
 return result
end
M.functions={survey_production=read}
return M
