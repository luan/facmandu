-- Robot controller fixture: ordinary robot stocks, then synthetic busy/cap signals.
local M={}
local species={logistic='logistic-robot',construction='construction-robot'}
function M.setup(args,entities,surface)
 if #entities>64 then error('Test a standalone robot controller with at most 64 entities',0) end
 local port=entities[args and args.port]
 if not port or port.type~='roboport' then error('robots.port must identify the controller roboport',0) end
 local targets={}
 for kind,name in pairs(species) do
  local t=args[kind]
  if not t or type(t.minimumIdle)~='number' or t.minimumIdle%1~=0 or t.minimumIdle<1 or t.minimumIdle>64 or type(t.maximumTotal)~='number' or t.maximumTotal%1~=0 or t.maximumTotal<=t.minimumIdle+1 or t.maximumTotal>5000 then error('Choose robot idle reserves 1..64 and a total cap above the reserve, up to 5000',0) end
  targets[kind]={name=name,minimum=t.minimumIdle,maximum=t.maximumTotal}
 end
 return {port=port,surface=surface,targets=targets,stage='reserve',evidence={},passed=true}
end
local function counts(f,kind)
 local n=f.port.valid and f.port.logistic_network
 if not n then return {idle=0,total=0} end
 return kind=='logistic' and {idle=n.available_logistic_robots,total=n.all_logistic_robots} or {idle=n.available_construction_robots,total=n.all_construction_robots}
end
local function record(f,kind,stage,c,met,added)
 local t=f.targets[kind]
 f.evidence[#f.evidence+1]={name=t.name,stage=stage,idle=c.idle,total=c.total,minimumIdle=t.minimum,maximumTotal=t.maximum,effectiveTotal=stage=='busy near cap' and t.maximum-1+(added or 0) or nil,added=added,met=met}
 f.passed=f.passed and met
end
local function demand(f)
 local b=f.port.get_or_create_control_behavior()
 if not b.read_robot_stats then error('Enable robot statistics on the controller roboport',0) end
 local at=f.surface.find_non_colliding_position('constant-combinator',f.port.position,12,.5)
 if not at then error('No space for the temporary demand signal fixture',0) end
 local helper=f.surface.create_entity{name='constant-combinator',position=at,force=f.port.force}
 if not helper then error('Could not create demand signal fixture',0) end
 local filters={}
 for kind,t in pairs(f.targets) do
  local idle=kind=='logistic' and b.available_logistic_output_signal or b.available_construction_output_signal
  local total=kind=='logistic' and b.total_logistic_output_signal or b.total_construction_output_signal
  if not idle or not total then error('Configure idle and total robot signals on the roboport',0) end
  for _,row in ipairs{{idle,-1000000},{total,t.maximum-t.baseline.total-1}} do
   local signal=row[1]
   filters[#filters+1]={value={type=signal.type or 'item',name=signal.name,quality='normal',comparator='='},min=row[2]}
  end
 end
 local cb=helper.get_or_create_control_behavior()
 local section=cb.get_section(1) or cb.add_section()
 section.filters=filters
 local connected=false
 for _,id in ipairs{defines.wire_connector_id.circuit_red,defines.wire_connector_id.circuit_green} do
  local connector=f.port.get_wire_connector(id,false)
  if connector and connector.connection_count>0 then
   local ok=helper.get_wire_connector(id,true).connect_to(connector,true,defines.wire_origin.script)
   connected=connected or ok
  end
 end
 if not connected then error('Wire the roboport robot statistics to its deployment controller',0) end
 f.helper=helper
end
function M.tick(f,sampling)
 if not sampling then return false end
 if f.stage=='reserve' then
  for kind,t in pairs(f.targets) do
   local c=counts(f,kind);t.baseline=c
   record(f,kind,'idle reserve',c,c.idle>=t.minimum and c.idle<=t.minimum+3 and c.total<=t.maximum)
  end
  if not f.passed then return true end
  demand(f);f.stage='demand';f.due=game.tick+900
 elseif game.tick>=f.due and f.stage=='demand' then
  for kind,t in pairs(f.targets) do
   local c=counts(f,kind);t.afterDemand=c
   local added=c.total-t.baseline.total
   record(f,kind,'busy near cap',c,added==1,added)
  end
  f.helper.get_or_create_control_behavior().enabled=false
  if not f.passed then return true end
  f.stage='settle';f.due=game.tick+900
 elseif game.tick>=f.due and f.stage=='settle' then
  for kind,t in pairs(f.targets) do
   local c=counts(f,kind)
   record(f,kind,'demand cleared',c,c.total==t.afterDemand.total and c.idle>=t.minimum,c.total-t.afterDemand.total)
  end
  return true
 end
 return false
end
return M
