local function range(force,p)
 if p.type~='inserter' or not script or not script.active_mods or not script.active_mods.Smart_Inserters then return nil end
 local function setting(name) return settings.startup[name] and settings.startup[name].value end
 local maximum,mode=setting('si-max-inserters-range'),setting('si-range-adder')
 if type(maximum)~='number' or type(mode)~='string' then error('Smart Inserters range settings are unavailable',0) end
 local function distance(v)
  return math.max(math.abs(math.floor((v.x or v[1])+0.5)),math.abs(math.floor((v.y or v[2])+0.5)))
 end
 local footprint=(math.max(p.tile_width,p.tile_height)-1)/2
 local native=math.max(distance(p.inserter_pickup_position),distance(p.inserter_drop_position))-footprint
 local minimum=1
 if mode=='inserter' or mode=='inserter-with-rebase' then maximum=native
 elseif mode=='incremental' or mode=='incremental-with-rebase' then maximum=maximum+native
 elseif mode~='equal' and mode~='rebase' then error('Unknown Smart Inserters range mode',0) end
 if mode=='rebase' or mode=='incremental-with-rebase' or mode=='inserter-with-rebase' then minimum=native end
 local increment=5
 if setting('si-range-technologies') then
  increment=0
  for level=5,1,-1 do
   local tech=force.technologies['si-unlock-range-'..level]
   if tech and tech.researched and not tech.prototype.hidden then increment=level;break end
  end
 end
 -- Match Smart Inserters 2.1 range settings and researched reach. Other mods need
 -- their own documented range API; native allow_custom_vectors alone has no cap.
 return math.min(maximum,minimum+increment)+footprint
end
local function profile(force,p)
 local limit=range(force,p)
 if not limit or not p.allow_custom_vectors then return nil end
 local function setting(name) return settings.startup[name] and settings.startup[name].value end
 local function researched(name) return force.technologies[name] and force.technologies[name].researched or false end
 return {range=limit,cross=not setting('si-diagonal-technologies') or researched('si-unlock-cross'),
  diagonal=not setting('si-diagonal-technologies') or researched('si-unlock-x-diagonals'),
  all=not setting('si-diagonal-technologies') or researched('si-unlock-all-diagonals'),
  offsets=not setting('si-offset-technologies') or researched('si-unlock-offsets')}
end
return {range=range,profile=profile}
