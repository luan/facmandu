local M={}
local force_lookup=require('scripts.tools.force_lookup')
local surface_lookup=require('scripts.tools.surface_lookup')
local territory=require('scripts.tools.territory')
M.manifest={inspect_territory={desc='Read native demolisher territory boundaries around a proposed site. Returns exact 32-tile chunk bounds, active guardians, cleared and unguarded chunks, and unexplored/unknown chunks. Choose an explored unguarded/cleared area large enough for the entire build and its routes. Unguarded means no active territorial guardian, not absence of other enemies, lava or collisions. Never reveals or generates terrain. Blueprint placement rejects guarded chunks even when collision-free.',params={surface='string! exact surface',x='number! center x',y='number! center y',radius='number optional default 96, max 480'}}}
local function inspect(a)
 local force=force_lookup.require_force(a.force)
 local surface,missing=surface_lookup.find(a.surface)
 if not surface then return missing end
 if surface.platform and surface.platform.force~=force then error('Choose a surface belonging to this force',0) end
 for _,axis in ipairs{'x','y'} do if type(a[axis])~='number' or a[axis]~=a[axis] or math.abs(a[axis])>1000000 then error('Use a finite territory center',0) end end
 local radius=a.radius or 96
 if type(radius)~='number' or radius~=radius or radius<0 or radius>480 then error('Choose a territory radius from 0 to 480',0) end
 local read=territory.reader(force,surface)
 local guardian_types={}
 local rows,counts={},{guarded=0,unguarded=0,cleared=0,unexplored=0,unknown=0}
 for x=math.floor((a.x-radius)/32),math.floor((a.x+radius)/32) do
  for y=math.floor((a.y-radius)/32),math.floor((a.y+radius)/32) do
   local row=read(x,y)
   for name in pairs(row.guardians or {}) do guardian_types[name]=true end
   rows[#rows+1]={x=x,y=y,status=row.status};counts[row.status]=counts[row.status]+1
  end
 end
 local names={} for name in pairs(guardian_types) do names[#names+1]=name end table.sort(names)
 return {force=force.name,surface=surface.name,tick=game.tick,chunk_size=32,chunks=rows,counts=counts,guardian_types=names,note='Native territory assignments at this tick. Chunk (x,y) covers [x*32,y*32] to [(x+1)*32,(y+1)*32). Builds and routes must stay in explored unguarded or cleared chunks; other enemies, terrain and collisions need separate checks.'}
end
M.functions={inspect_territory=inspect}
return M
