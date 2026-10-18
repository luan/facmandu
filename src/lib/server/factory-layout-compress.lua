-- Replace straight transport runs with native underground pairs. Junctions,
-- machine connections and declared factory ports always stay on the surface.
return function(entities,ports,pack)
 local at,protected={},{}
 local function key(x,y) return x..','..y end
 local directions={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
 local function point(p) return math.floor(p.x),math.floor(p.y) end
 for _,e in ipairs(entities) do local x,y=point(e.position);at[key(x,y)]=e end
 for _,p in ipairs(ports) do local x,y=point(p.position);protected[key(x,y)]=true end
 for _,e in ipairs(entities) do
  local arm=pack.inserters[e.name]
  if arm then
   for _,entry in ipairs{{e.pickup_position,arm.pickup_position},{e.drop_position,arm.insert_position}} do
    local p=entry[1]
    local x,y
    if p then x,y=p.x,p.y else x,y=entry[2][1],entry[2][2];for _=1,(e.direction or 0)/4 do x,y=-y,x end end
    protected[key(math.floor(e.position.x+x),math.floor(e.position.y+y))]=true
   end
  elseif pack.loaders and pack.loaders[e.name] then
   local v=directions[e.direction or 0]
   for _,sign in ipairs{-1,1} do protected[key(math.floor(e.position.x)+v[1]*sign,math.floor(e.position.y)+v[2]*sign)]=true end
  end
 end
 local function pair_clear(first,last,vertical,kind,name)
  local x1,y1=point(first.position);local x2,y2=point(last.position)
  local start,finish=vertical and y1 or x1,vertical and y2 or x2
  start,finish=math.min(start,finish),math.max(start,finish)
  local line=vertical and x1 or y1
  local pieces={}
  for _,e in ipairs(entities) do
   local relevant=kind=='pipe' and pack.pipes[e.name] and pack.pipes[e.name].underground or kind=='belt' and e.name==name
   if relevant then
    local x,y=point(e.position)
    if (e.direction or 0)%8==(vertical and 0 or 4) and (vertical and x or y)==line then pieces[#pieces+1]={position=vertical and y or x,direction=e.direction or 0} end
   end
  end
  table.sort(pieces,function(a,b) return a.position<b.position end)
  for i,p in ipairs(pieces) do
   if p.position>start and p.position<finish then return false end
   local n=pieces[i+1]
   if n and ((start>p.position and start<n.position) or (finish>p.position and finish<n.position)) then
    if kind=='pipe' and p.direction==(vertical and 0 or 12) and n.direction==(vertical and 8 or 4) then return false end
    if kind=='belt' then
     local e=at[key(vertical and line or p.position,vertical and p.position or line)]
     local next_e=at[key(vertical and line or n.position,vertical and n.position or line)]
     if e and next_e and p.direction==n.direction and ((e.type=='input' and next_e.type=='output' and p.direction==(vertical and 8 or 4)) or (e.type=='output' and next_e.type=='input' and p.direction==(vertical and 0 or 12))) then return false end
    end
   end
  end
  return true
 end
 local removed={}
 for _,kind in ipairs{'belt','pipe'} do
  for _,axis in ipairs{4,8} do
   local v=directions[axis];local vertical=axis==8
   local function eligible(e)
    if not e or removed[e] then return false end
    local x,y=point(e.position)
    if protected[key(x,y)] then return false end
    if kind=='belt' then
     if not pack.belts[e.name] or (e.direction or 0)~=axis then return false end
     for _,d in ipairs{(axis+4)%16,(axis+12)%16} do
      local w=directions[d];local n=at[key(x+w[1],y+w[2])]
      if n and (pack.belts[n.name] or pack.undergrounds[n.name] and n.type=='output') and (n.direction or 0)==(d+8)%16 then return false end
     end
    else
     if not pack.pipes[e.name] or pack.pipes[e.name].underground then return false end
     for _,d in ipairs{(axis+4)%16,(axis+12)%16} do
      local w=directions[d];local n=at[key(x+w[1],y+w[2])]
      if n and pack.pipes[n.name] and (not pack.pipes[n.name].underground or (n.direction or 0)==(d+8)%16) then return false end
     end
    end
    return true
   end
   local candidates={} for _,e in ipairs(entities) do if eligible(e) then candidates[#candidates+1]=e end end
   table.sort(candidates,function(a,b) local x,y=point(a.position);local u,w=point(b.position);return vertical and (x<u or x==u and y<w) or not vertical and (y<w or y==w and x<u) end)
   for _,first in ipairs(candidates) do if eligible(first) then
    local name,reach
    if kind=='belt' then
     for n,p in pairs(pack.undergrounds) do if p.speed==pack.belts[first.name].speed then name,reach=n,p.max_distance;break end end
    else for n,p in pairs(pack.pipes) do if p.underground then name,reach=n,p.underground;break end end end
    if name then
     local x,y=point(first.position);local run={first}
     for distance=1,reach do local e=at[key(x+v[1]*distance,y+v[2]*distance)]
      if not eligible(e) or e.name~=first.name then break end
      run[#run+1]=e
     end
     if #run>=4 and pair_clear(first,run[#run],vertical,kind,name) then
      local last=run[#run]
      first.name=name;last.name=name
      if kind=='pipe' then first.direction=(axis+8)%16;last.direction=axis
      else first.type='input';last.type='output' end
      for i=2,#run-1 do local e=run[i];local tx,ty=point(e.position);at[key(tx,ty)]=nil;removed[e]=true end
     end
    end
   end end
  end
 end
 local result={}
 for _,e in ipairs(entities) do if not removed[e] then e.entity_number=#result+1;result[#result+1]=e end end
 return result
end
