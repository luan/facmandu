-- Solid interfaces are independent of the transport between production stages.
local interfaces={}
function interfaces.prepare(problem,pack,robot_cells,options)
 local modes=problem.transport
 if not modes or (not robot_cells and modes.inputs=='belts' and modes.outputs=='belts') then return {install=function() end,left=0,bottom=2} end
 local loader
 for name in pairs(pack.loaders or {}) do if not loader or name<loader then loader=name end end
 local arm=pack.inserters[problem.tiers.inserter]
 local cap=(arm.stack_size or 1)*arm.rotation_speed*60*.6*60
 local lane=pack.belts[problem.tiers.belt].items_per_second*30
 local profile,settings=options.arm(arm,arm.custom and arm.custom.cross and arm.custom.range>=1 and {pickup={x=0,y=-1},drop={x=0,y=1}} or nil)
 local pickup,drop=-math.floor(profile.pickup.y+.5),math.floor(profile.drop.y+.5)
 assert(loader or (profile.pickup.x==0 and profile.drop.x==0 and pickup>0 and drop>0),'Boundary transport needs an axial inserter or researched adjustable reach')
 local reach=pickup+drop
 local pending,replaced,swaps={},{},{}
 local state={left=0,bottom=2}
 local function add(name,x,y,extra,port)
  assert(x>=.5 and y>=.5 and x<problem.area[2][1] and y<problem.area[2][2],'Solid transport interfaces do not fit this block')
  local e=extra or {};e.name=name;e.position={x=x,y=y};e.direction=e.direction or 0
  pending[#pending+1]={entity=e,port=port}
  problem.obstacles[#problem.obstacles+1]={x=math.floor(x),y=math.floor(y)}
 end
 local function arm_at(x,y,direction)
  local e={direction=direction}
  for key,p in pairs(settings) do
   local x,y=p.x,p.y
   for _=1,direction/4 do x,y=-y,x end
   e[key]={x=x,y=y};e.direction=0
  end
  add(problem.tiers.inserter,x,y,e)
 end
 local function requests(item,rate,from_buffers)
  return {request_filters={request_from_buffers=from_buffers or nil,sections={{index=1,filters={{index=1,type='item',name=item,quality='normal',comparator='=',count=math.max(1,math.ceil(rate*problem.logistics.requestSeconds/60))}}}}}}
 end
 local function endpoint(port,kind,rate) return {item=port.item,kind=kind,perMinute=rate} end
 local function replace(port,kind) replaced[kind..'/'..port.item]=true end
 local function swap(port,name,direction,kind)
  swaps[port.position.x..','..port.position.y]={name=name,direction=direction,type=kind}
 end
 if not robot_cells and modes.inputs=='requester-chests' then
  local y=0
  for _,port in ipairs(problem.inputs) do
   replace(port,'input')
   if loader then
    port.position={x=1.5,y=y+.5};port.direction=4
    swap(port,loader,4,'output')
    add(problem.logistics.requester,.5,y+.5,requests(port.item,port.perMinute),endpoint(port,'input',port.perMinute))
    y=y+3
   else
    local sides=port.perMinute>lane+1e-6 and 2 or 1
    local count=math.max(1,math.ceil(port.perMinute/sides/cap-1e-9))
    port.position={x=count-.5,y=y+reach+.5};port.direction=4
    for i=1,count do
     local x=i-.5
     if i<count then add(problem.tiers.belt,x,port.position.y,{direction=4}) end
     for side=1,sides do
      local sign=side==1 and -1 or 1
      arm_at(x,port.position.y+sign*drop,side==1 and 0 or 8)
      add(problem.logistics.requester,x,port.position.y+sign*reach,requests(port.item,port.perMinute/(sides*count)),endpoint(port,'input',port.perMinute/(sides*count)))
     end
    end
    problem.margin=math.max(problem.margin or 8,8+count-1)
    local branches=0
    for _,line in ipairs(pack.plan.lines) do for _,part in ipairs(line.ingredients) do if part.type=='item' and part.name==port.item then branches=branches+math.ceil(line.machines-1e-9) end end end
    y=y+reach*sides+math.max(1,branches)
   end
  end
  -- These are generated interfaces, so fluid approaches follow the new solid rows.
  problem.obstacles={}
  for _,p in ipairs(pending) do problem.obstacles[#problem.obstacles+1]={x=math.floor(p.entity.position.x),y=math.floor(p.entity.position.y)} end
  for _,port in ipairs(problem.fluid_inputs or {}) do port.position={x=.5,y=y+.5};port.direction=4;y=y+3 end
  local directions={[0]={0,-1},[4]={1,0},[8]={0,1},[12]={-1,0}}
  for _,entry in ipairs{{problem.fluid_inputs,1},{problem.outputs,-1}} do for _,p in ipairs(entry[1] or {}) do if entry[2]==1 or p.type=='fluid' then
   local v=directions[p.direction]
   for n=0,2 do problem.obstacles[#problem.obstacles+1]={x=math.floor(p.position.x)+v[1]*entry[2]*n,y=math.floor(p.position.y)+v[2]*entry[2]*n} end
  end end end
 end
 for _,port in ipairs(problem.outputs) do if port.type~='fluid' and not robot_cells and modes.outputs=='storage-chests' then
  replace(port,'output')
  if loader then
   port.position={x=port.position.x,y=problem.area[2][2]-2.5};port.direction=8
   -- Belts can accept a side feed; loader intakes require a straight approach.
   add(loader,port.position.x,port.position.y+1,{direction=8,type='input'})
   problem.bottom=math.max(problem.bottom or 1,3)
   add(problem.logistics.provider,port.position.x,port.position.y+2,options.product_settings(problem,pack,port.item),endpoint(port,'output',port.perMinute))
  else
   local count=math.max(1,math.ceil(port.perMinute/cap-1e-9))
   port.position={x=port.position.x,y=problem.area[2][2]-count+.5};port.direction=8
   for i=1,count do
    local x,y=port.position.x,port.position.y+i-1
    if i>1 then add(problem.tiers.belt,x,y,{direction=8}) end
    arm_at(x+pickup,y,12)
    add(problem.logistics.provider,x+reach,y,options.product_settings(problem,pack,port.item),endpoint(port,'output',port.perMinute/count))
   end
   problem.bottom=math.max(problem.bottom or 1,count)
  end
 end end
 if robot_cells and modes.inputs=='belts' then
  for _,port in ipairs(problem.inputs) do
   replace(port,'input')
   add(problem.tiers.belt,port.position.x,port.position.y,{direction=4},endpoint(port,'input',port.perMinute))
   if loader then
    add(loader,port.position.x+1,port.position.y,{direction=4,type='input'})
    add(problem.logistics.buffer,port.position.x+2,port.position.y,{bar=problem.logistics.outputSlots})
    state.left=math.max(state.left,4)
   else
    local count=math.max(1,math.ceil(port.perMinute/cap-1e-9))
    for i=1,count do
     local x=port.position.x+i-1
     if i>1 then add(problem.tiers.belt,x,port.position.y,{direction=4}) end
     arm_at(x,port.position.y+pickup,0)
     add(problem.logistics.buffer,x,port.position.y+reach,{bar=problem.logistics.outputSlots})
    end
    state.left=math.max(state.left,count+1)
   end
  end
 end
 if robot_cells and modes.outputs=='belts' then
  local x=0
  for _,port in ipairs(problem.outputs) do if port.type~='fluid' then
   replace(port,'output')
   if loader then
    local y=problem.area[2][2]-.5
    add(problem.logistics.requester,x+.5,y-2,requests(port.item,port.perMinute,true))
    add(loader,x+.5,y-1,{direction=8,type='output'})
    add(problem.tiers.belt,x+.5,y,{direction=8},endpoint(port,'output',port.perMinute))
    state.bottom=math.max(state.bottom,4);x=x+3
   else
    local sides=port.perMinute>lane+1e-6 and 2 or 1
    local count=math.max(1,math.ceil(port.perMinute/sides/cap-1e-9))
    local bx=x+reach+.5
    for i=1,count do
     local y=problem.area[2][2]-count+i-.5
     add(problem.tiers.belt,bx,y,{direction=8},i==count and endpoint(port,'output',port.perMinute) or nil)
     for side=1,sides do
      local sign=side==1 and -1 or 1
      arm_at(bx+sign*drop,y,side==1 and 12 or 4)
      add(problem.logistics.requester,bx+sign*reach,y,requests(port.item,port.perMinute/(sides*count),true))
     end
    end
    state.bottom=math.max(state.bottom,count+1);x=x+reach*sides+1
   end
  end end
 end
 function state.install(add_entity,ports,entities)
  for _,e in ipairs(entities) do local replacement=swaps[e.position.x..','..e.position.y]
   if replacement then for k,v in pairs(replacement) do e[k]=v end end
  end
  for i=#ports,1,-1 do if replaced[ports[i].kind..'/'..ports[i].item] then table.remove(ports,i) end end
  for _,p in ipairs(pending) do
   local e=p.entity;local id=add_entity(e.name,e.position.x,e.position.y,e)
   if p.port then p.port.entity=id;p.port.position=e.position;ports[#ports+1]=p.port end
  end
 end
 return state
end
return interfaces
