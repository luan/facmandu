-- Neutral resources are readable only in terrain charted by the asking force.
local force_lookup=require('scripts.tools.force_lookup')
local surface_lookup=require('scripts.tools.surface_lookup')
local M={}
M.manifest={find_resource_patches={desc='Find real resource patches, such as stone for a new mine, in a bounded area of terrain already charted by your force. Reads neutral resource entities, never enemy factories or unexplored terrain. Returns connected patch bounds, remaining resource amount and an actual resource-tile position. Partial/truncated scans cannot prove absence. This does not generate terrain, mine resources or build anything.',params={surface='string! surface name',name='string! exact resource entity prototype, e.g. stone',x='number! center x',y='number! center y',radius='number local radius, default 256, max 512'}}}
local function find(a)
 local force=force_lookup.require_force(a.force)
 local surface,miss=surface_lookup.find(a.surface)
 if not surface then return miss end
 local p=type(a.name)=='string' and prototypes.entity[a.name]
 if not p or p.type~='resource' then error('Choose a real resource entity prototype, e.g. stone',0) end
 local radius=a.radius or 256
 for _,v in ipairs({a.x,a.y,radius}) do if type(v)~='number' or v~=v or math.abs(v)>1000000 then error('Resource search requires finite x/y/radius',0) end end
 if a.x==nil or a.y==nil or radius<1 or radius>512 then error('Resource search requires x/y and radius 1 to 512',0) end
 local scanned=surface.find_entities_filtered{force='neutral',type='resource',name=a.name,position={x=a.x,y=a.y},radius=radius,limit=8192}
 local tiles={}
 local shown=0
 for _,e in ipairs(scanned) do
  if force.is_chunk_charted(surface,{x=math.floor(e.position.x/32),y=math.floor(e.position.y/32)}) then
   tiles[math.floor(e.position.x)..':'..math.floor(e.position.y)]=e;shown=shown+1
  end
 end
 local patches={}
 while next(tiles) do
  local key,first=next(tiles);tiles[key]=nil
  local queue={first};local cursor=1
  local row={name=a.name,tiles=0,amount=0,bounds={left=first.position.x-0.5,top=first.position.y-0.5,right=first.position.x+0.5,bottom=first.position.y+0.5},position=first.position}
  local nearest=math.huge
  while cursor<=#queue do
   local e=queue[cursor];cursor=cursor+1
   row.tiles=row.tiles+1;row.amount=row.amount+e.amount
   row.bounds.left=math.min(row.bounds.left,e.position.x-0.5);row.bounds.right=math.max(row.bounds.right,e.position.x+0.5)
   row.bounds.top=math.min(row.bounds.top,e.position.y-0.5);row.bounds.bottom=math.max(row.bounds.bottom,e.position.y+0.5)
   local distance=(e.position.x-a.x)^2+(e.position.y-a.y)^2
   if distance<nearest then nearest=distance;row.position=e.position end
   for dx=-1,1 do for dy=-1,1 do
    local k=(math.floor(e.position.x)+dx)..':'..(math.floor(e.position.y)+dy)
    if tiles[k] then queue[#queue+1]=tiles[k];tiles[k]=nil end
   end end
  end
  row.distance=math.sqrt(nearest)
  row.gps='[gps='..row.position.x..','..row.position.y..','..surface.name..']'
  patches[#patches+1]=row
 end
 table.sort(patches,function(a,b) return a.distance<b.distance end)
 local result={}
 for i=1,math.min(12,#patches) do result[i]=patches[i] end
 return {force=force.name,surface=surface.name,scanned=#scanned,charted_tiles=shown,truncated=#scanned==8192,total_patches=#patches,shown=#result,patches=result,note='Bounds describe only scanned, charted resource tiles. Inspect obstacles and drill coverage before placing a mine.'}
end
M.functions={find_resource_patches=find}
return M
