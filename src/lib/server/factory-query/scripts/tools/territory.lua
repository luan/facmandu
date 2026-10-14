-- Read native territory assignments, never infer them from a demolisher's position.
local M={}
function M.reader(force,surface)
 local chunks={}
 return function(x,y)
  local key=x..':'..y
  if chunks[key] then return chunks[key] end
  local chunk={x=x,y=y}
  local row={chunk=chunk,status='unguarded'}
  if not surface.is_chunk_generated(chunk) or not force.is_chunk_charted(surface,chunk) then
   row.status='unexplored'
  elseif not surface.get_territory_for_chunk then
   row.status='unknown'
  else
   local territory=surface.get_territory_for_chunk(chunk)
   if territory then
    local names={}
    for _,unit in ipairs(territory.get_segmented_units()) do
     if unit.valid then names[unit.prototype.name]=(names[unit.prototype.name] or 0)+1 end
    end
    if next(names) then row.status='guarded';row.guardians=names else row.status='cleared' end
   end
  end
  chunks[key]=row
  return row
 end
end
function M.blocked(read,left,top,right,bottom)
 for x=math.floor(left/32),math.ceil(right/32)-1 do
  for y=math.floor(top/32),math.ceil(bottom/32)-1 do
   local row=read(x,y)
   if row.status~='unguarded' and row.status~='cleared' then return row end
  end
 end
end
return M
