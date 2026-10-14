-- Bounded, read-only routing. Native placement checks decide which tiles fit;
-- the search never clears obstacles, reveals terrain or places anything.
local force_lookup=require('scripts.tools.force_lookup')
local surface_lookup=require('scripts.tools.surface_lookup')
local territories=require('scripts.tools.territory')
local M={}
M.manifest={route_belt={desc='Use the dedicated route_belt tool to design a charted, collision-free belt connection. It can use matching underground belts to cross obstacles and returns saved blueprint sections. Existing endpoints must be same-force transport belts; unrelated buildings and underground connections are preserved. No demolition, landfill, construction or material grants occur.',params={surface='string! exact surface',belt='string! transport-belt prototype',underground='string optional matching underground-belt prototype',x='number! start tile center x',y='number! start tile center y',target_x='number! destination tile center x',target_y='number! destination tile center y',target_lane='string optional left, right or both; side loading requires a built straight bus belt with an inline feed',margin='number optional detour margin, default 16, max 64'}}}
local directions={{dx=0,dy=-1,d=0},{dx=1,dy=0,d=4},{dx=0,dy=1,d=8},{dx=-1,dy=0,d=12}}
local function before(a,b) return a.f<b.f or (a.f==b.f and a.h<b.h) end
local function push(heap,node)
 local i=#heap+1
 while i>1 do local parent=math.floor(i/2);if not before(node,heap[parent]) then break end;heap[i]=heap[parent];i=parent end
 heap[i]=node
end
local function pop(heap)
 local result,last=heap[1],table.remove(heap)
 if #heap>0 then
  local i=1
  while i*2<=#heap do
   local child=i*2
   if child<#heap and before(heap[child+1],heap[child]) then child=child+1 end
   if not before(heap[child],last) then break end
   heap[i]=heap[child];i=child
  end
  heap[i]=last
 end
 return result
end
local function route(a)
 local force=force_lookup.require_force(a.force)
 local surface,missing=surface_lookup.find(a.surface)
 if not surface then return missing end
 if surface.platform and surface.platform.force~=force then error('Choose a surface belonging to this force',0) end
 local belt=type(a.belt)=='string' and prototypes.entity[a.belt]
 if not belt or belt.type~='transport-belt' or belt.tile_width~=1 or belt.tile_height~=1 then error('Choose a native one-tile transport belt',0) end
 local underground=a.underground and prototypes.entity[a.underground]
 if a.underground and (not underground or underground.type~='underground-belt' or underground.tile_width~=1 or underground.tile_height~=1 or underground.belt_speed~=belt.belt_speed) then error('Choose a matching one-tile underground belt with the same speed',0) end
 for _,key in ipairs({'x','y','target_x','target_y'}) do
  local value=a[key]
  if type(value)~='number' or value~=value or math.abs(value)>1000000 or value%1~=0.5 then error('Use exact half-tile belt centers from native lookups',0) end
 end
 local span=math.abs(a.x-a.target_x)+math.abs(a.y-a.target_y)
 -- Segment routes longer than 512 tiles; raise this after a longer live route
 -- demonstrates that the bounded search can stay within the game-tick budget.
 if span<1 or span>512 then error('Choose distinct endpoints within 512 tiles; split longer routes at charted waypoints',0) end
 local margin=a.margin or 16
 if type(margin)~='number' or margin~=margin or margin%1~=0 or margin<1 or margin>64 then error('Choose a detour margin from 1 to 64 tiles',0) end
 local left,right=math.min(a.x,a.target_x)-margin,math.max(a.x,a.target_x)+margin
 local top,bottom=math.min(a.y,a.target_y)-margin,math.max(a.y,a.target_y)+margin
 local planned,occupied_plan,planned_tunnels,planned_entities={},{},{},{}
 local plan_tiles=0
 if a.obstacles and (type(a.obstacles)~='table' or #a.obstacles>1000) then error('Route around at most 1000 planned entities',0) end
 for _,e in ipairs(a.obstacles or {}) do
  local p=type(e.name)=='string' and prototypes.entity[e.name]
  if not p or type(e.position)~='table' then error('Invalid planned obstacle',0) end
  for _,axis in ipairs{'x','y'} do
   local value=e.position[axis]
   if type(value)~='number' or value~=value or math.abs(value)>1000000 then error('Invalid planned obstacle position',0) end
  end
  local d=e.direction or 0
  if type(d)~='number' or d%1~=0 or d<0 or d>15 then error('Invalid planned obstacle direction',0) end
  local w,h=p.tile_width,p.tile_height
  -- Conservative footprints match blueprint overlap validation. Diagonal
  -- layouts use the enclosing square until diagonal routing is supported.
  if d%4~=0 then w,h=math.max(w,h),math.max(w,h) elseif d%8==4 then w,h=h,w end
  local x,y=e.position.x,e.position.y
  local x1,x2=math.max(math.floor(x-w/2),math.floor(left)),math.min(math.ceil(x+w/2)-1,math.floor(right))
  local y1,y2=math.max(math.floor(y-h/2),math.floor(top)),math.min(math.ceil(y+h/2)-1,math.floor(bottom))
  plan_tiles=plan_tiles+math.max(0,x2-x1+1)*math.max(0,y2-y1+1)
  -- Keep footprint indexing bounded independently of mod machine dimensions.
  if plan_tiles>32768 then error('Planned footprints are too large for one route; choose nearby sections',0) end
  for tx=x1,x2 do
   for ty=y1,y2 do occupied_plan[tx..':'..ty]=true end
  end
  if e.name==a.underground then planned_tunnels[#planned_tunnels+1]=e end
  if p.type=='transport-belt' and w==1 and h==1 then
   local candidate={name=e.name,type=p.type,prototype=p,position=e.position,direction=d,force=force}
   planned[x..':'..y]=candidate;planned_entities[candidate]=true
  end
 end
 local charted,placements={},{}
 local territory=territories.reader(force,surface)
 local function known(x,y)
  local cx,cy=math.floor(x/32),math.floor(y/32)
  local key=cx..':'..cy
  if charted[key]==nil then charted[key]=force.is_chunk_charted(surface,{x=cx,y=cy}) end
  if not charted[key] then return false end
  local status=territory(cx,cy).status
  return status=='unguarded' or status=='cleared'
 end
 local function placeable(name,x,y,d)
  local check={name=name,position={x=x,y=y},direction=d,force=force,build_check_type=defines.build_check_type.manual,forced=false}
  if surface.can_place_entity(check) then return true end
  -- Blueprint checks honor queued foundation/landfill without supplying it.
  -- Script-ghost checks permit unsupported terrain and must never be used here.
  local ghosts=surface.get_tile(check.position).get_tile_ghosts()
  if #ghosts==0 then return false end
  for _,ghost in ipairs(ghosts) do if ghost.force~=force then return false end end
  check.build_check_type=defines.build_check_type.blueprint_ghost
  return surface.can_place_entity(check)
 end
 local function endpoint(x,y)
  if not known(x,y) then error('Route endpoint is unexplored or in guarded demolisher territory; inspect_territory and choose an explored unguarded endpoint',0) end
  local entity=surface.find_entity(a.belt,{x=x,y=y})
  if entity and entity.force==force then return entity end
  -- A different belt tier is also a valid connection, without replacing it.
  for _,other in ipairs(surface.find_entities_filtered{position={x=x,y=y},type={'transport-belt','entity-ghost'},force=force,limit=8}) do
   local native=other.type=='entity-ghost' and other.ghost_prototype or other.prototype
   if native.type=='transport-belt' and other.position.x==x and other.position.y==y then return other end
  end
  local draft=planned[x..':'..y]
  if draft and placeable(draft.name,x,y,draft.direction) then return draft end
 end
 local start_entity,end_entity=endpoint(a.x,a.y),endpoint(a.target_x,a.target_y)
 local entry_direction
 if a.target_lane~=nil then
  if a.target_lane~='left' and a.target_lane~='right' and a.target_lane~='both' then error('Choose target_lane left, right or both',0) end
  if not end_entity or end_entity.type~='transport-belt' or planned_entities[end_entity] then error('Lane routing requires a built destination belt',0) end
  if a.target_lane~='both' then
   -- A corner maps both source lanes through its turn. Side loading needs an
   -- existing inline feed to keep the destination straight after construction.
   local inline=false
   for _,e in pairs(end_entity.belt_neighbours.inputs) do
    if e.force==force and e.direction==end_entity.direction then inline=true end
   end
   if end_entity.belt_shape~='straight' or not inline then error('Choose a straight bus belt with an existing inline feed for side loading',0) end
  end
  entry_direction=(end_entity.direction+(a.target_lane=='left' and 4 or a.target_lane=='right' and 12 or 0))%16
 end
 local function entry_allowed(d) return not entry_direction or d==entry_direction end
 local function fits(name,x,y,d)
  if x<left or x>right or y<top or y>bottom or not known(x,y) then return false end
  local key=name..':'..x..':'..y..':'..d
  if placements[key]==nil then
   -- Manual checks permit fast replacement of belts. Routing must retain them.
   local occupied=surface.find_entities_filtered{position={x=x,y=y},type={'transport-belt','underground-belt','splitter','loader','loader-1x1','entity-ghost'},limit=1}
   placements[key]=not occupied_plan[math.floor(x)..':'..math.floor(y)] and #occupied==0 and placeable(name,x,y,d)
  end
  return placements[key]
 end
 local function tunnel_clear(x,y,n,step)
  -- Avoid accidentally pairing with another same-tier underground connection.
  local distance=underground.max_underground_distance
  local tx,ty=x+step.dx*n,y+step.dy*n
  local area={{math.min(x,tx)-distance,math.min(y,ty)-distance},{math.max(x,tx)+distance,math.max(y,ty)+distance}}
  local entities=surface.find_entities_filtered{area=area,name=a.underground,force=force,limit=64}
  if #entities==64 then return false end
  for _,e in ipairs(entities) do
   if e.direction==step.d and ((step.dx~=0 and e.position.y==y) or (step.dy~=0 and e.position.x==x)) then return false end
  end
  local ghosts=surface.find_entities_filtered{area=area,type='entity-ghost',force=force,limit=64}
  if #ghosts==64 then return false end
  for _,e in ipairs(ghosts) do
   if e.ghost_name==a.underground and e.direction==step.d and ((step.dx~=0 and e.position.y==y) or (step.dy~=0 and e.position.x==x)) then return false end
  end
  for _,e in ipairs(planned_tunnels) do
   if (e.direction or 0)==step.d and ((step.dx~=0 and e.position.y==y) or (step.dy~=0 and e.position.x==x)) then
    if e.position.x>=area[1][1] and e.position.x<=area[2][1] and e.position.y>=area[1][2] and e.position.y<=area[2][2] then return false end
   end
  end
  for i=1,n-1 do if not known(x+step.dx*i,y+step.dy*i) then return false end end
  return true
 end
 local function key(x,y,d,tunnel) return x..':'..y..':'..tostring(d)..':'..tostring(tunnel) end
 if not start_entity then
  local accessible=false
  for _,step in ipairs(directions) do
   if fits(a.belt,a.x,a.y,step.d) then accessible=true;break end
  end
  if not accessible then
   return {found=false,surface=surface.name,visited=0,sourceBlocked={x=a.x,y=a.y},
    note='The start coordinate cannot accept a belt in any direction. Inspect sourceBlocked for existing or planned footprints and native terrain support, then choose the actual output endpoint. A wider detour cannot fix the start. No buildings or terrain were changed.'}
  end
 end
 if end_entity then
  local accessible=false
  for _,step in ipairs(directions) do
   if entry_allowed(step.d) and (step.d+8)%16~=end_entity.direction and fits(a.belt,a.target_x-step.dx,a.target_y-step.dy,step.d) then accessible=true;break end
  end
  if not accessible then return {found=false,surface=surface.name,visited=0,note='The destination is surrounded by existing transport. Inspect its upstream feed or plan the necessary connection edits; routing does not replace those belts.'} end
 end
 local function finish(path,visited)
  local entities,positions={},{}
  for i,p in ipairs(path) do
   local position=p.x..':'..p.y
   if positions[position] then return {found=false,surface=surface.name,visited=visited,note='The bounded route would overlap itself. Choose a charted waypoint to separate its approaches.'} end
   positions[position]=true
   if not (i==1 and start_entity) and not (i==#path and end_entity) then
    local next_edge=path[i+1]
    local jump_in=next_edge and next_edge.jump
    local jump_out=p.jump
    local d=jump_in and jump_in.d or (path[i+1] and path[i+1].d or p.d)
    entities[#entities+1]={name=(jump_in or jump_out) and a.underground or a.belt,position={x=p.x,y=p.y},direction=d,type=jump_in and 'input' or jump_out and 'output' or nil}
   end
  end
  if #entities>800 then error('Route has too many entities; choose a closer waypoint',0) end
  local function existing(e) return e and not planned_entities[e] and {name=e.type=='entity-ghost' and e.ghost_name or e.name,ghost=e.type=='entity-ghost',unit_number=e.unit_number,position=e.position,direction=e.direction} or nil end
  local function planned_endpoint(e) return e and planned_entities[e] and {name=e.name,position=e.position,direction=e.direction} or nil end
  return {found=true,force=force.name,surface=surface.name,tick=game.tick,visited=visited,entities=entities,start=existing(start_entity),destination=existing(end_entity),plannedStart=planned_endpoint(start_entity),plannedDestination=planned_endpoint(end_entity),destination_lane=a.target_lane,note='Native collision and chart checks passed at this tick. Existing and planned endpoints are retained; saved draft footprints were avoided. Inspect the combined blueprint again before ghost placement; transport flow and power still need verification.'}
 end
 -- Most delivery corridors need one corner. Check both shortest orthogonal
 -- paths before searching thousands of direction/underground states.
 for _,horizontal_first in ipairs{true,false} do
  local path={{x=a.x,y=a.y,d=start_entity and start_entity.direction or nil}}
  local function line(axis,target)
   local current=path[#path]
   while current[axis]~=target do
    local dx=axis=='x' and (target>current.x and 1 or -1) or 0
    local dy=axis=='y' and (target>current.y and 1 or -1) or 0
    local d=dx==1 and 4 or dx==-1 and 12 or dy==1 and 8 or 0
    current={x=current.x+dx,y=current.y+dy,d=d};path[#path+1]=current
   end
  end
  if horizontal_first then line('x',a.target_x);line('y',a.target_y)
  else line('y',a.target_y);line('x',a.target_x) end
  local valid=true
  for i=1,#path-1 do
   local from,to=path[i],path[i+1]
   local first=i==1 and start_entity
   local last=i+1==#path and end_entity
   local source_ok=(first and to.d==start_entity.direction) or (not first and fits(a.belt,from.x,from.y,to.d))
   local target_ok=(last and known(to.x,to.y) and entry_allowed(to.d) and (to.d+8)%16~=end_entity.direction) or (not last and fits(a.belt,to.x,to.y,to.d))
   if not source_ok or not target_ok then valid=false;break end
  end
  if valid then return finish(path,#path) end
 end
 local heap,best={},{}
 local function enqueue(x,y,d,tunnel,g,parent,jump)
  local id=key(x,y,d,tunnel)
  if best[id] and best[id]<=g then return end
  -- Direction states may revisit a tile, but a physical route cannot. Keep
  -- immutable parents so improving another state cannot rewrite this path.
  local ancestor=parent
  while ancestor do
   if ancestor.x==x and ancestor.y==y then return end
   ancestor=ancestor.parent
  end
  local h=math.abs(x-a.target_x)+math.abs(y-a.target_y)
  -- Favor progress over exhaustive shortest-path search within the tick budget.
  -- A route may use more undergrounds; native safety checks still apply to every edge.
  local node={x=x,y=y,d=d,tunnel=tunnel,g=g,h=h,f=g+h*1.2,id=id,parent=parent,jump=jump}
  best[id]=g;push(heap,node)
 end
 enqueue(a.x,a.y,start_entity and start_entity.direction or nil,false,0)
 local visited=0
 local closest
 while #heap>0 and visited<5000 do
  local node=pop(heap)
  if node.g==best[node.id] then
   visited=visited+1
   if not node.tunnel and node.h<span and (not closest or node.h<closest.h or (node.h==closest.h and node.g<closest.g)) then closest=node end
   if node.x==a.target_x and node.y==a.target_y then
    local path={};local current=node
    while current do table.insert(path,1,current);current=current.parent end
    return finish(path,visited)
   end
   for _,step in ipairs(directions) do
    local may_turn=not node.tunnel and not (node.x==a.x and node.y==a.y and start_entity)
    if may_turn or step.d==node.d then
     local x,y=node.x+step.dx,node.y+step.dy
     local source_ok=(node.x==a.x and node.y==a.y and start_entity) or fits(node.tunnel and a.underground or a.belt,node.x,node.y,step.d)
     local at_end=x==a.target_x and y==a.target_y
     local target_ok=(at_end and end_entity and known(x,y) and entry_allowed(step.d) and (step.d+8)%16~=end_entity.direction) or fits(a.belt,x,y,step.d)
     -- Prefer readable straight runs over equally short zigzags.
     local turn=node.d~=nil and node.d~=step.d and 0.25 or 0
     if source_ok and target_ok then enqueue(x,y,step.d,false,node.g+1+turn,node) end
     if underground and not node.tunnel and node.d==step.d and not (node.x==a.x and node.y==a.y and start_entity) and fits(a.underground,node.x,node.y,step.d) then
      local length=math.min(underground.max_underground_distance,32)
      for n=2,length do
       local tx,ty=node.x+step.dx*n,node.y+step.dy*n
       -- Keep section joins on surface belts. A following section must not
       -- replace an underground exit when the shared endpoint is combined.
       local at_destination=tx==a.target_x and ty==a.target_y
       if not at_destination and fits(a.underground,tx,ty,step.d) and tunnel_clear(node.x,node.y,n,step) then enqueue(tx,ty,step.d,true,node.g+n+2,node,{d=step.d}) end
      end
     end
    end
   end
  end
 end
 if visited==1 and start_entity then
  for _,step in ipairs(directions) do
   if step.d==start_entity.direction then
    return {force=force.name,surface=surface.name,tick=game.tick,found=false,visited=visited,
     sourceExit={x=a.x+step.dx,y=a.y+step.dy,direction=step.d},
     note='The start belt has no usable forward step. Inspect sourceExit and adjust the proposed outlet or its requested connection; a wider detour cannot fix this first step. Existing belts and buildings are retained.'}
   end
  end
 end
 return {force=force.name,surface=surface.name,tick=game.tick,found=false,visited=visited,closestApproach=closest and {x=closest.x,y=closest.y,remaining=closest.h} or nil,note=visited>=5000 and 'Search budget reached; try a section ending at closestApproach before continuing, or narrow the detour area. No route has been exported.' or 'No charted collision-free route within this area. closestApproach is a reachable surface-belt frontier, not a completed connection. Inspect beyond it or choose a wider detour; routing does not demolish buildings or place landfill.'}
end
M.functions={route_belt=route}
return M
