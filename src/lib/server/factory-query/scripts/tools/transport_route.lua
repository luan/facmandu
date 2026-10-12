-- Bounded, read-only routing. Native placement checks decide which tiles fit;
-- the search never clears obstacles, reveals terrain or places anything.
local force_lookup=require('scripts.tools.force_lookup')
local surface_lookup=require('scripts.tools.surface_lookup')
local M={}
M.manifest={route_belt={desc='Use the dedicated route_belt tool to design a charted, collision-free belt connection. It can use matching underground belts to cross obstacles and returns saved blueprint sections. Existing endpoints must be same-force transport belts; unrelated buildings and underground connections are preserved. No demolition, landfill, construction or material grants occur.',params={surface='string! exact surface',belt='string! transport-belt prototype',underground='string optional matching underground-belt prototype',x='number! start tile center x',y='number! start tile center y',target_x='number! destination tile center x',target_y='number! destination tile center y',margin='number optional detour margin, default 16, max 64'}}}
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
 local charted,placements={},{}
 local function known(x,y)
  local cx,cy=math.floor(x/32),math.floor(y/32)
  local key=cx..':'..cy
  if charted[key]==nil then charted[key]=force.is_chunk_charted(surface,{x=cx,y=cy}) end
  return charted[key]
 end
 local function endpoint(x,y)
  if not known(x,y) then error('Explore both route endpoints first',0) end
  local entity=surface.find_entity(a.belt,{x=x,y=y})
  if entity and entity.force==force then return entity end
  -- A different belt tier is also a valid connection, without replacing it.
  for _,other in ipairs(surface.find_entities_filtered{position={x=x,y=y},type={'transport-belt','entity-ghost'},force=force,limit=8}) do
   local native=other.type=='entity-ghost' and other.ghost_prototype or other.prototype
   if native.type=='transport-belt' and other.position.x==x and other.position.y==y then return other end
  end
 end
 local start_entity,end_entity=endpoint(a.x,a.y),endpoint(a.target_x,a.target_y)
 local function fits(name,x,y,d)
  if x<left or x>right or y<top or y>bottom or not known(x,y) then return false end
  local key=name..':'..x..':'..y..':'..d
  if placements[key]==nil then
   -- Manual checks permit fast replacement of belts. Routing must retain them.
   local occupied=surface.find_entities_filtered{position={x=x,y=y},type={'transport-belt','underground-belt','splitter','loader','loader-1x1','entity-ghost'},limit=1}
   placements[key]=#occupied==0 and surface.can_place_entity{name=name,position={x=x,y=y},direction=d,force=force,build_check_type=defines.build_check_type.manual,forced=false}
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
  for i=1,n-1 do if not known(x+step.dx*i,y+step.dy*i) then return false end end
  return true
 end
 local function key(x,y,d,tunnel) return x..':'..y..':'..tostring(d)..':'..tostring(tunnel) end
 if end_entity then
  local accessible=false
  for _,step in ipairs(directions) do
   if (step.d+8)%16~=end_entity.direction and fits(a.belt,a.target_x-step.dx,a.target_y-step.dy,step.d) then accessible=true;break end
  end
  if not accessible then return {found=false,surface=surface.name,visited=0,note='The destination is surrounded by existing transport. Inspect its upstream feed or plan the necessary connection edits; routing does not replace those belts.'} end
 end
 local heap,best,parents,nodes={},{},{},{}
 local function enqueue(x,y,d,tunnel,g,parent,jump)
  local id=key(x,y,d,tunnel)
  if best[id] and best[id]<=g then return end
  local h=math.abs(x-a.target_x)+math.abs(y-a.target_y)
  local node={x=x,y=y,d=d,tunnel=tunnel,g=g,h=h,f=g+h,id=id}
  best[id]=g;nodes[id]=node;parents[id]={id=parent,jump=jump};push(heap,node)
 end
 enqueue(a.x,a.y,start_entity and start_entity.direction or nil,false,0)
 local visited=0
 while #heap>0 and visited<5000 do
  local node=pop(heap)
  if node.g==best[node.id] then
   visited=visited+1
   if node.x==a.target_x and node.y==a.target_y then
    local path={};local current=node
    while current do table.insert(path,1,current);current=parents[current.id].id and nodes[parents[current.id].id] or nil end
    local entities,positions={},{}
    for i,p in ipairs(path) do
     local position=p.x..':'..p.y
     if positions[position] then return {found=false,surface=surface.name,visited=visited,note='The bounded route would overlap itself. Choose a charted waypoint to separate its approaches.'} end
     positions[position]=true
     if not (i==1 and start_entity) and not (i==#path and end_entity) then
      local next_edge=path[i+1] and parents[path[i+1].id]
      local jump_in=next_edge and next_edge.jump
      local jump_out=parents[p.id].jump
      local d=jump_in and jump_in.d or (path[i+1] and path[i+1].d or p.d)
      entities[#entities+1]={name=(jump_in or jump_out) and a.underground or a.belt,position={x=p.x,y=p.y},direction=d,type=jump_in and 'input' or jump_out and 'output' or nil}
     end
    end
    if #entities>800 then error('Route has too many entities; choose a closer waypoint',0) end
    local function existing(e) return e and {name=e.type=='entity-ghost' and e.ghost_name or e.name,ghost=e.type=='entity-ghost',unit_number=e.unit_number,position=e.position,direction=e.direction} or nil end
    return {found=true,force=force.name,surface=surface.name,tick=game.tick,visited=visited,entities=entities,start=existing(start_entity),destination=existing(end_entity),note='Native collision and chart checks passed at this tick. Existing endpoints are retained. Inspect the saved blueprint again before ghost placement; transport flow and power still need verification.'}
   end
   for _,step in ipairs(directions) do
    local may_turn=not node.tunnel and not (node.x==a.x and node.y==a.y and start_entity)
    if may_turn or step.d==node.d then
     local x,y=node.x+step.dx,node.y+step.dy
     local source_ok=(node.x==a.x and node.y==a.y and start_entity) or fits(node.tunnel and a.underground or a.belt,node.x,node.y,step.d)
     local at_end=x==a.target_x and y==a.target_y
     local target_ok=(at_end and end_entity and known(x,y) and (step.d+8)%16~=end_entity.direction) or fits(a.belt,x,y,step.d)
     if source_ok and target_ok then enqueue(x,y,step.d,false,node.g+1,node.id) end
     if underground and not node.tunnel and node.d==step.d and not (node.x==a.x and node.y==a.y and start_entity) and fits(a.underground,node.x,node.y,step.d) then
      local length=math.min(underground.max_underground_distance,32)
      for n=2,length do
       local tx,ty=node.x+step.dx*n,node.y+step.dy*n
       local retained_end=end_entity and tx==a.target_x and ty==a.target_y
       if not retained_end and fits(a.underground,tx,ty,step.d) and tunnel_clear(node.x,node.y,n,step) then enqueue(tx,ty,step.d,true,node.g+n+2,node.id,{d=step.d}) end
      end
     end
    end
   end
  end
 end
 return {force=force.name,surface=surface.name,tick=game.tick,found=false,visited=visited,note=visited>=5000 and 'Search budget reached; use a closer charted waypoint or a narrower detour area.' or 'No charted collision-free route within this area. Inspect the obstruction; this tool does not demolish buildings or place landfill.'}
end
M.functions={route_belt=route}
return M
