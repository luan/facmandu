-- Read-only pipe routing. Other fluid systems are obstacles, including their
-- open ports: a collision-free pipe must not silently join another fluid line.
local force_lookup=require('scripts.tools.force_lookup')
local surface_lookup=require('scripts.tools.surface_lookup')
local territories=require('scripts.tools.territory')
local heap=require('scripts.tools.routing_heap')
local M={}
M.manifest={route_pipe={desc='Draft a native pipe connection without mixing other fluid systems, replacing entities or entering guarded or unexplored terrain. Use the route_pipes tool to save the result. Existing endpoints must be same-force pipes; empty endpoints can meet a matching native fluid port. Requires Factorio 2.1.',params={surface='string! exact surface',pipe='string! one-tile pipe prototype',underground='string optional one-tile pipe-to-ground prototype',fluid='string! exact fluid prototype',x='number! source tile center',y='number! source tile center',target_x='number! destination tile center',target_y='number! destination tile center',margin='number optional detour margin, default 16, maximum 32'}}}
local directions={{dx=0,dy=-1,d=0},{dx=1,dy=0,d=4},{dx=0,dy=1,d=8},{dx=-1,dy=0,d=12}}
local function key(x,y) return x..':'..y end
local function route(a)
 local major,minor=(script.active_mods.base or ''):match('^(%d+)%.(%d+)')
 if not tonumber(major) or (tonumber(major)<2 or tonumber(major)==2 and tonumber(minor)<1) then error('Native pipe routing requires Factorio 2.1',0) end
 local force=force_lookup.require_force(a.force)
 local surface,missing=surface_lookup.find(a.surface);if not surface then return missing end
 if surface.platform and surface.platform.force~=force then error('Choose a surface belonging to this force',0) end
 local pipe=type(a.pipe)=='string' and prototypes.entity[a.pipe]
 local underground=a.underground and prototypes.entity[a.underground]
 if not pipe or pipe.type~='pipe' or pipe.tile_width~=1 or pipe.tile_height~=1 then error('Choose a native one-tile pipe',0) end
 if a.underground and (not underground or underground.type~='pipe-to-ground' or underground.tile_width~=1 or underground.tile_height~=1) then error('Choose a native one-tile underground pipe',0) end
 if type(a.fluid)~='string' or not prototypes.fluid[a.fluid] then error('Choose the exact fluid prototype',0) end
 local function standard(p,tunnel)
  if #p.fluidbox_prototypes~=1 then return false end
  local box=p.fluidbox_prototypes[1]
  if box.filter and box.filter.name~=a.fluid then return false end
  local connections=box.pipe_connections
  if #connections~=(tunnel and 2 or 4) then return false end
  local seen={}
  for _,c in ipairs(connections) do
   if c.flow_direction~='input-output' then return false end
   for _,at in ipairs(c.positions) do if at.x~=0 or at.y~=0 then return false end end
   seen[c.connection_type..':'..c.direction]=true
  end
  return tunnel and seen['normal:0'] and seen['underground:8'] or not tunnel and seen['normal:0'] and seen['normal:4'] and seen['normal:8'] and seen['normal:12']
 end
 -- Special port geometry needs a native connection-aware router. Standard
 -- four-way pipes and north-opening undergrounds cover the current game pipes.
 if not standard(pipe,false) or underground and not standard(underground,true) then error('Choose standard bidirectional pipe ports compatible with this fluid',0) end
 if underground then
  local compatible=false
  for _,p in ipairs(pipe.fluidbox_prototypes[1].pipe_connections) do
   for _,u in ipairs(underground.fluidbox_prototypes[1].pipe_connections) do
    if u.connection_type=='normal' then for _,x in ipairs(p.connection_category) do for _,y in ipairs(u.connection_category) do if x==y then compatible=true end end end end
   end
  end
  if not compatible then error('Choose compatible normal pipe connection categories',0) end
 end
 for _,k in ipairs{'x','y','target_x','target_y'} do local v=a[k];if type(v)~='number' or v~=v or math.abs(v)>1000000 or v%1~=.5 then error('Use exact half-tile pipe centers',0) end end
 local span=math.abs(a.x-a.target_x)+math.abs(a.y-a.target_y)
 -- Longer fluid systems need explicit pump/segment planning, not an unchecked
 -- pipe across the map. Raise this after native extent and tick-budget tests.
 if span<1 or span>256 then error('Choose distinct pipe endpoints within 256 tiles; split longer routes at inspected waypoints',0) end
 local margin=a.margin or 16
 if type(margin)~='number' or margin%1~=0 or margin<1 or margin>32 then error('Choose a pipe detour margin from 1 to 32',0) end
 local left,right=math.min(a.x,a.target_x)-margin,math.max(a.x,a.target_x)+margin
 local top,bottom=math.min(a.y,a.target_y)-margin,math.max(a.y,a.target_y)+margin
 local read=territories.reader(force,surface)
 local function known(x,y) local s=read(math.floor(x/32),math.floor(y/32)).status;return s=='unguarded' or s=='cleared' end
 local function explored(x,y) return read(math.floor(x/32),math.floor(y/32)).status~='unexplored' end
 if not known(a.x,a.y) or not known(a.target_x,a.target_y) then error('Pipe endpoints must be explored and outside active demolisher territory',0) end
 local occupied,open_ports,tunnels={},{},{}
 local indexed_tiles=0
 local function at_end(x,y) return x==a.x and y==a.y or x==a.target_x and y==a.target_y end
 local function planned_box(e)
  local p=prototypes.entity[e.name];if not p then error('Unknown planned obstacle',0) end
  local x,y=e.position.x,e.position.y;local d=e.direction or 0
  local w,h=p.tile_width,p.tile_height
  if d%4~=0 then w,h=math.max(w,h),math.max(w,h) elseif d%8==4 then w,h=h,w end
  local x1,x2=math.max(math.floor(x-w/2),math.floor(left)),math.min(math.ceil(x+w/2)-1,math.floor(right))
  local y1,y2=math.max(math.floor(y-h/2),math.floor(top)),math.min(math.ceil(y+h/2)-1,math.floor(bottom))
  indexed_tiles=indexed_tiles+math.max(0,x2-x1+3)*math.max(0,y2-y1+3)
  if indexed_tiles>32768 then error('Too many planned fluid footprints in this corridor; choose nearby sections',0) end
  for tx=x1,x2 do for ty=y1,y2 do occupied[key(tx+.5,ty+.5)]=true end end
  if #p.fluidbox_prototypes>0 then
   -- Future machine ports cannot yet be checked against native fluid storage.
   -- Keep them isolated until recipe-specific ghost-port validation is available.
   for tx=x1-1,x2+1 do for ty=y1-1,y2+1 do open_ports[key(tx+.5,ty+.5)]=true end end
  end
  if p.type=='pipe' or p.type=='pipe-to-ground' then
   if p.type=='pipe-to-ground' then tunnels[#tunnels+1]={position=e.position,direction=d} end
  end
 end
 if a.obstacles and (type(a.obstacles)~='table' or #a.obstacles>1000) then error('Route around at most 1000 planned entities',0) end
 for _,e in ipairs(a.obstacles or {}) do
  if type(e.position)~='table' then error('Invalid planned obstacle',0) end
  for _,axis in ipairs{'x','y'} do local v=e.position[axis];if type(v)~='number' or v~=v or math.abs(v)>1000000 then error('Invalid planned obstacle position',0) end end
  local d=e.direction or 0;if type(d)~='number' or d%1~=0 or d<0 or d>15 then error('Invalid planned obstacle direction',0) end
  local p=prototypes.entity[e.name];if not p then error('Unknown planned obstacle',0) end
  planned_box(e)
 end
 local function endpoint(x,y)
  for _,e in pairs(surface.find_entities_filtered{position={x=x,y=y},force=force,type={'pipe','pipe-to-ground'},limit=8}) do
   if e.position.x==x and e.position.y==y then
    if e.to_be_deconstructed() then error('A pipe endpoint is marked for deconstruction; inspect and retain it or choose a stable feed',0) end
    if e.name~=a.pipe and e.name~=a.underground then error('Use the same pipe prototypes as the existing endpoints; mixed prototype adapters need a separately inspected join',0) end
    return e
   end
  end
 end
 local source,destination=endpoint(a.x,a.y),endpoint(a.target_x,a.target_y)
 local allowed={}
 local function network(e)
  if not e then return end
  local queue={{entity=e,index=1}};local head=1
  while head<=#queue do
   if head>1024 then error('Fluid endpoint network exceeds the inspection budget; inspect a smaller isolated segment',0) end
   local node=queue[head];head=head+1
   local id=node.entity.unit_number..':'..node.index
   if not allowed[id] then
    local native=node.entity
    if native.force~=force or not explored(native.position.x,native.position.y) then error('A fluid endpoint connects beyond this force or explored area',0) end
    local fluid=native.get_fluid(node.index);local filter=native.get_fluid_filter(node.index)
    if fluid and fluid.name~=a.fluid or filter and filter.fluid and filter.fluid.name~=a.fluid then error('A pipe endpoint contains or requires another fluid',0) end
    allowed[id]=true
    for _,n in ipairs(native.get_fluid_box_neighbours(node.index) or {}) do queue[#queue+1]=n end
   end
  end
 end
 network(source)
 if source and destination and allowed[destination.unit_number..':1'] then
  return {found=true,force=force.name,surface=surface.name,tick=game.tick,visited=0,entities={},note='The native endpoints already share a fluid connection. No additional pipes were drafted; actual delivery and available capacity still need measurement.'}
 end
 network(destination)
 local nearby=surface.find_entities_filtered{area={{left-32,top-32},{right+32,bottom+32}},limit=6000}
 if #nearby>=6000 then error('Pipe corridor is too crowded; split it into shorter sections',0) end
 for _,e in pairs(nearby) do
  if explored(e.position.x,e.position.y) then
   if e.type=='entity-ghost' then
    if #e.ghost_prototype.fluidbox_prototypes>0 then planned_box{name=e.ghost_name,position=e.position,direction=e.direction} end
   else
    if e.type=='pipe-to-ground' then tunnels[#tunnels+1]=e end
    if e.fluids_count>32 then error('A nearby fluid entity exceeds the port inspection budget; choose a smaller isolated corridor',0) end
    for i=1,e.fluids_count do
     if not allowed[(e.unit_number or 0)..':'..i] then
      for _,c in ipairs(e.get_fluid_box_pipe_connections(i) or {}) do
       if c.connection_type=='normal' then
        local p=c.target_position;local filter=e.get_fluid_filter(i);local fluid=e.get_fluid(i)
        local matching=(filter and filter.fluid and filter.fluid.name==a.fluid) or (fluid and fluid.name==a.fluid)
        if not (e.force==force and at_end(p.x,p.y) and matching) then open_ports[key(p.x,p.y)]=true end
       end
      end
     end
    end
   end
  end
 end
 local cache={}
 local function fits(name,x,y,d)
  if x<left or x>right or y<top or y>bottom or not known(x,y) or occupied[key(x,y)] or open_ports[key(x,y)] then return false end
  local id=name..':'..x..':'..y..':'..d
  if cache[id]==nil then
   local q={name=name,position={x=x,y=y},direction=d,force=force,build_check_type=defines.build_check_type.ghost_revive,forced=false}
   -- Pipe routing preserves every existing entity, including fast-replaceable pipes.
   local p=surface.find_entities_filtered{position=q.position,type={'pipe','pipe-to-ground','entity-ghost'},limit=1}
   cache[id]=#p==0 and surface.can_place_entity(q)
  end
  return cache[id]
 end
 local function end_direction(e,d,start)
  return not e or e.type=='pipe' or d==(start and e.direction or (e.direction+8)%16)
 end
 local function tunnel_clear(x,y,n,d,dx,dy,node)
  for i=1,n-1 do if not known(x+dx*i,y+dy*i) then return false end end
  local distance=math.min(underground.max_underground_distance,32)
  for _,e in ipairs(tunnels) do
   local p=e.position
   if ((dx~=0 and p.y==y and math.abs(p.x-x)<=n+distance) or (dy~=0 and p.x==x and math.abs(p.y-y)<=n+distance)) and (e.direction%8==d%8) then return false end
  end
  while node and node.parent do
   if node.jump and node.jump%8==d%8 then
    local p,q=node,node.parent
    local axis=dx~=0 and 'x' or 'y';local cross=dx~=0 and 'y' or 'x'
    local from,to=axis=='x' and x or y,axis=='x' and x+dx*n or y+dy*n
    if p[cross]==(cross=='x' and x or y) and math.max(math.min(p[axis],q[axis]),math.min(from,to))<=math.min(math.max(p[axis],q[axis]),math.max(from,to)) then return false end
   end
   node=node.parent
  end
  return true
 end
 local function finish(node,visited)
  local path={};while node do table.insert(path,1,node);node=node.parent end
  local entities={}
  for i,p in ipairs(path) do
   if not (i==1 and source) and not (i==#path and destination) then
    local entering=path[i+1] and path[i+1].jump
    entities[#entities+1]={name=(entering or p.jump) and a.underground or a.pipe,position={x=p.x,y=p.y},direction=entering and (entering+8)%16 or p.jump or 0}
   end
  end
  local function native(e) return e and {name=e.name,ghost=false,unit_number=e.unit_number,position=e.position,direction=e.direction} or nil end
  return {found=true,force=force.name,surface=surface.name,tick=game.tick,visited=visited,entities=entities,start=native(source),destination=native(destination),note='Native collision, fluid-network and territory checks passed. Unrelated fluid ports and underground pairs were avoided. Reinspect the combined design before placement and measure actual fluid delivery; pump capacity, system extent and production are not verified.'}
 end
 local queue,best={},{}
 local function enqueue(x,y,d,tunnel,g,parent,jump)
  local id=key(x,y)..':'..tostring(d)..':'..tostring(tunnel)
  if best[id] and best[id]<=g then return end
  local ancestor=parent;while ancestor do if ancestor.x==x and ancestor.y==y then return end;ancestor=ancestor.parent end
  local h=math.abs(x-a.target_x)+math.abs(y-a.target_y)
  local node={x=x,y=y,d=d,tunnel=tunnel,g=g,h=h,f=g+h*1.2,parent=parent,jump=jump,id=id}
  best[id]=g;heap.push(queue,node)
 end
 if not source and not fits(a.pipe,a.x,a.y,0) then return {found=false,surface=surface.name,visited=0,sourceBlocked={x=a.x,y=a.y},note='The pipe source is occupied, guarded or touches an unrelated or unverified planned fluid port. Choose its actual built outlet.'} end
 if not destination and not fits(a.pipe,a.target_x,a.target_y,0) then return {found=false,surface=surface.name,visited=0,note='The pipe destination is occupied, guarded or touches an unrelated or unverified planned fluid port. Choose the intended built recipe port.'} end
 enqueue(a.x,a.y,nil,false,0)
 local visited,closest=0,nil
 -- Bound search independently of corridor area. Expand after native profiling
 -- demonstrates that a larger search stays within the live game-tick budget.
 while #queue>0 and visited<1000 do
  local node=heap.pop(queue)
  if best[node.id]==node.g then
   visited=visited+1
   if not node.tunnel and node.h<span and (not closest or node.h<closest.h) then closest=node end
   if node.x==a.target_x and node.y==a.target_y then return finish(node,visited) end
   for _,step in ipairs(directions) do
    local first=node.x==a.x and node.y==a.y
    if (not node.tunnel or node.d==step.d) and (not first or end_direction(source,step.d,true)) then
     local x,y=node.x+step.dx,node.y+step.dy
     local last=x==a.target_x and y==a.target_y
     if (last and destination and end_direction(destination,step.d,false)) or fits(a.pipe,x,y,0) then enqueue(x,y,step.d,false,node.g+1+(node.d and node.d~=step.d and .25 or 0),node) end
     if underground and not first and not node.tunnel and node.d==step.d and fits(a.underground,node.x,node.y,(step.d+8)%16) then
      for n=2,math.min(underground.max_underground_distance,32) do
       local tx,ty=node.x+step.dx*n,node.y+step.dy*n
       if not at_end(tx,ty) and fits(a.underground,tx,ty,step.d) and tunnel_clear(node.x,node.y,n,step.d,step.dx,step.dy,node) then enqueue(tx,ty,step.d,true,node.g+n*.25+2,node,step.d) end
      end
     end
    end
   end
  end
 end
 return {found=false,surface=surface.name,visited=visited,closestApproach=closest and {x=closest.x,y=closest.y,remaining=closest.h} or nil,note='No safe pipe connection within the bounded search. Inspect the closest approach or split this connection into sections; no construction or fluid was changed.'}
end
M.functions={route_pipe=route}
return M
