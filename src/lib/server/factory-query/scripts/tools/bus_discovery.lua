-- Parallel straight runs identify candidate buses; item counts are a snapshot,
-- not a measured rate or proof that a corridor is the player's intended bus.
local force_lookup=require('scripts.tools.force_lookup')
local surface_lookup=require('scripts.tools.surface_lookup')
local M={}
M.manifest={find_buses={desc='Find candidate parallel belt corridors near an inspected factory, including actual belts carrying a requested item and exposed upstream taps traced through at most 128 native belt entities. Reads only this force’s built belts. A candidate has at least three nearby parallel lanes connected by overlapping straight runs of at least 16 tiles. Item counts are a snapshot, not throughput. Inspect the matching belt before connecting; a truncated scan cannot prove absence. This does not build, chart terrain or change any belt.',params={surface='string! surface name',x='number! center x',y='number! center y',product='string optional exact item prototype to locate in bus lanes',radius='number optional default 128, maximum 512'}}}
local function find(a)
 local force=force_lookup.require_force(a.force)
 local surface,missing=surface_lookup.find(a.surface)
 if not surface then return missing end
 if surface.platform and surface.platform.force~=force then error('Choose a surface belonging to this force',0) end
 local radius=a.radius or 128
 for _,value in ipairs({a.x,a.y,radius}) do if type(value)~='number' or value~=value or math.abs(value)>1000000 then error('Use finite bus-search coordinates',0) end end
 if a.x==nil or a.y==nil or radius<1 or radius>512 then error('Use x/y and a radius from 1 to 512',0) end
 if a.product and not prototypes.item[a.product] then error('Use an exact item prototype from this game',0) end
 local scanned=surface.find_entities_filtered{force=force,type='transport-belt',position={x=a.x,y=a.y},radius=radius,limit=8192}
 local function accessible(e)
  for _,step in ipairs({{dx=0,dy=-1,d=0},{dx=1,dy=0,d=4},{dx=0,dy=1,d=8},{dx=-1,dy=0,d=12}}) do
   if (step.d+8)%16~=e.direction then
    local position={x=e.position.x-step.dx,y=e.position.y-step.dy}
    if force.is_chunk_charted(surface,{x=math.floor(position.x/32),y=math.floor(position.y/32)}) then
     local occupied=surface.find_entities_filtered{position=position,type={'transport-belt','underground-belt','splitter','loader','loader-1x1','entity-ghost'},limit=1}
     if #occupied==0 and surface.can_place_entity{name=e.name,position=position,direction=step.d,force=force,build_check_type=defines.build_check_type.manual,forced=false} then return true end
    end
   end
  end
  return false
 end
 local function upstream_tap(start)
  local queue,seen={start},{}
  for i=1,128 do
   local e=queue[i]
   if not e then break end
   if not seen[e.unit_number] then
    seen[e.unit_number]=true
    if e.type=='transport-belt' and accessible(e) then return e end
    for _,input in pairs(e.belt_neighbours.inputs) do
     if input.force==force and (input.type=='transport-belt' or input.type=='underground-belt') then queue[#queue+1]=input end
    end
    if e.type=='underground-belt' and e.belt_to_ground_type=='output' then
     local input=e.underground_belt_neighbour
     if input and input.force==force then queue[#queue+1]=input end
    end
   end
  end
 end
 local columns={}
 for _,e in ipairs(scanned) do
  if e.belt_shape=='straight' and (e.direction==0 or e.direction==4 or e.direction==8 or e.direction==12) then
   local vertical=e.direction==0 or e.direction==8
   local lane=vertical and e.position.x or e.position.y
   local key=e.direction..':'..lane
   columns[key]=columns[key] or {direction=e.direction,lane=lane,vertical=vertical,belts={}}
   columns[key].belts[#columns[key].belts+1]=e
  end
 end
 local runs={}
 for _,column in pairs(columns) do
  local function axis(e) return column.vertical and e.position.y or e.position.x end
  table.sort(column.belts,function(a,b) return axis(a)<axis(b) end)
  local first=1
  for i=1,#column.belts do
   if i==#column.belts or axis(column.belts[i+1])-axis(column.belts[i])~=1 then
    if i-first+1>=16 then runs[#runs+1]={column=column,first=first,last=i,low=axis(column.belts[first]),high=axis(column.belts[i])} end
    first=i+1
   end
  end
 end
 table.sort(runs,function(a,b) if a.column.direction~=b.column.direction then return a.column.direction<b.column.direction end;if a.column.lane~=b.column.lane then return a.column.lane<b.column.lane end;return a.low<b.low end)
 local total_runs=#runs
 while #runs>256 do table.remove(runs) end
 local parents={}
 for i=1,#runs do parents[i]=i end
 local function root(i) while parents[i]~=i do parents[i]=parents[parents[i]];i=parents[i] end;return i end
 for i=1,#runs do for j=i+1,#runs do
  local x,y=runs[i],runs[j]
  if x.column.direction==y.column.direction and math.abs(x.column.lane-y.column.lane)<=3 and math.min(x.high,y.high)-math.max(x.low,y.low)>=15 then parents[root(j)]=root(i) end
 end end
 local groups={}
 for i,run in ipairs(runs) do local id=root(i);groups[id]=groups[id] or {};groups[id][#groups[id]+1]=run end
 local candidates={}
 for _,group in pairs(groups) do
  local distinct={};local lane_count=0
  for _,run in ipairs(group) do if not distinct[run.column.lane] then distinct[run.column.lane]=true;lane_count=lane_count+1 end end
  if lane_count>=3 then
   local lanes={};local nearest=math.huge;local matching=0;local accessible_connections=0
   for _,run in ipairs(group) do
    local counts={left=0,right=0,totalLeft=0,totalRight=0};local target;local distance=math.huge
    for i=run.first,run.last do
     local e=run.column.belts[i]
     local left,right=e.get_transport_line(1),e.get_transport_line(2)
     counts.totalLeft=counts.totalLeft+left.get_item_count();counts.totalRight=counts.totalRight+right.get_item_count()
     local wanted_left=a.product and left.get_item_count(a.product) or 0
     local wanted_right=a.product and right.get_item_count(a.product) or 0
     counts.left=counts.left+wanted_left;counts.right=counts.right+wanted_right
     if not a.product or wanted_left+wanted_right>0 then
      local d=(e.position.x-a.x)^2+(e.position.y-a.y)^2
      if d<distance then distance=d;target=e end
     end
    end
    if target then target=upstream_tap(target) or target end
    local approach=target and accessible(target) or false
    if approach and (not a.product or counts.left+counts.right>0) then accessible_connections=accessible_connections+1 end
    if counts.left+counts.right>0 then matching=matching+1 end
    nearest=math.min(nearest,distance)
    local mixed_left,mixed_right
    if a.product then mixed_left=counts.totalLeft>counts.left;mixed_right=counts.totalRight>counts.right end
    lanes[#lanes+1]={direction=run.column.direction,length=run.last-run.first+1,position=run.column.lane,productLeft=counts.left,productRight=counts.right,mixedLeft=mixed_left,mixedRight=mixed_right,connection=target and {name=target.name,unit_number=target.unit_number,position=target.position,direction=target.direction,approachAvailable=approach,capacityPerMinute=target.prototype.belt_speed*480*60} or nil}
   end
   table.sort(lanes,function(a,b)
    local am,bm=a.productLeft+a.productRight>0,b.productLeft+b.productRight>0
    if am~=bm then return am end
    return a.position<b.position
   end)
   if not a.product or matching>0 then candidates[#candidates+1]={direction=group[1].column.direction,lanes=lanes,laneCount=lane_count,matchingLanes=matching,accessibleConnections=accessible_connections,distance=math.sqrt(nearest)} end
  end
 end
 table.sort(candidates,function(a,b) if (a.accessibleConnections>0)~=(b.accessibleConnections>0) then return a.accessibleConnections>0 end;if a.laneCount~=b.laneCount then return a.laneCount>b.laneCount end;return a.distance<b.distance end)
 local shown={}
 for i=1,math.min(3,#candidates) do
  local candidate=candidates[i]
  candidate.lanesShown=math.min(8,#candidate.lanes)
  while #candidate.lanes>8 do table.remove(candidate.lanes) end
  shown[#shown+1]=candidate
 end
 return {force=force.name,surface=surface.name,product=a.product,scanned=#scanned,straightRuns=total_runs,total=#candidates,truncated=#scanned==8192 or total_runs>256,candidates=shown,note='Candidate parallel corridors from this tick. Connection points belong to matching lanes or their native upstream feeds; approachAvailable checks adjacent charted space. Counts are occupied items, not rates. Inspect transport topology and free capacity before joining.'}
end
M.functions={find_buses=find}
return M
