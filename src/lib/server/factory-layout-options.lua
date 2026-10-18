-- Shared logistics-cell geometry. Vectors stay relative to north-facing arms.
local options={}
local function tile(v) return math.floor(v+0.5) end
function options.arm(arm,chosen)
  if not chosen then return {pickup={x=arm.pickup_position[1],y=arm.pickup_position[2]},drop={x=arm.insert_position[1],y=arm.insert_position[2]}},{} end
  local custom=assert(arm.custom,'The current inserter mod does not expose a qualified custom reach')
  for _,v in ipairs{chosen.pickup,chosen.drop} do
   local x,y=tile(v.x),tile(v.y)
   assert((x~=0 or y~=0) and math.max(math.abs(x),math.abs(y))<=custom.range,'Custom inserter vector exceeds researched reach')
   assert(custom.all or (custom.cross and (x==0 or y==0)) or (custom.diagonal and math.abs(x)==math.abs(y)),'Custom inserter angle is not researched')
   assert(custom.offsets or (v.x==x and v.y==y),'Custom inserter offsets are not researched')
  end
  return chosen,{pickup_position=chosen.pickup,drop_position=chosen.drop}
 end
function options.cell(w,h,problem,pack,fluid)
 local arm=assert(pack.inserters[problem.tiers.inserter])
 local input_profile=problem.inserters and problem.inserters.input
 local output_profile=problem.inserters and problem.inserters.output
 if arm.custom and arm.custom.cross and arm.custom.range>=1 then
  -- A quarter-turn reaches the same machine with less chest clearance than straight arms.
  input_profile=input_profile or {pickup={x=-1,y=0},drop={x=0,y=1}}
  output_profile=output_profile or {pickup={x=0,y=-1},drop={x=1,y=0}}
 end
 local input,ins=options.arm(arm,input_profile);local output,outs=options.arm(arm,output_profile)
 local function attach(v)
  local x,y=tile(v.x),tile(v.y)
  assert(x~=0 or y~=0,'Inserter vector must reach another tile')
  local target={x=math.floor(w/2)+0.5,y=math.floor(h/2)+0.5}
  if math.abs(y)>=math.abs(x) then target.y=y>0 and 0.5 or h-0.5
  else target.x=x>0 and 0.5 or w-0.5 end
  return {x=target.x-x,y=target.y-y}
 end
 local ia,oa=attach(input.drop),attach(output.pickup)
 local ic={x=ia.x+tile(input.pickup.x),y=ia.y+tile(input.pickup.y)}
 local oc={x=oa.x+tile(output.drop.x),y=oa.y+tile(output.drop.y)}
 local points={ia,oa,ic,oc}
 local occupied={}
 local left,top,right,bottom=0,-2,w,h+2
 for _,p in ipairs(points) do
  assert(not (p.x>0 and p.x<w and p.y>0 and p.y<h),'Inserter profile intersects its machine')
  local k=p.x..','..p.y;assert(not occupied[k],'Inserter profiles overlap a chest or another arm');occupied[k]=true
  left=math.min(left,p.x-0.5);right=math.max(right,p.x+0.5)
  top=math.min(top,p.y-0.5);bottom=math.max(bottom,p.y+0.5)
 end
 local spacious=problem.layout.spacing=='spacious'
 local padding=fluid and 3 or 1
 local dx,dy=padding-left,-top
 for _,p in ipairs(points) do p.x=p.x+dx;p.y=p.y+dy end
 return {width=right-left+padding*2+(spacious and 1 or 0),height=bottom-top+1+(spacious and 3 or 0),
  machine={x=w/2+dx,y=h/2+dy},input_arm=ia,output_arm=oa,input_chest=ic,output_chest=oc,input_settings=ins,output_settings=outs}
end
function options.columns(count,width,height,available_width,available_height,shape)
 local maximum=math.min(count,math.floor(available_width/width))
 assert(maximum>0,'A production cell does not fit the selected width')
 local columns=maximum
 if shape=='tall' then columns=1
 elseif shape=='square' then
  local score
  for n=1,maximum do local rows=math.ceil(count/n)
   if rows*height<=available_height then
    local delta=math.abs(n*width-rows*height)
    if not score or delta<score then columns,score=n,delta end
   end
  end
 end
 assert(math.ceil(count/columns)*height<=available_height,'The requested logistics cells do not fit this layout shape; enlarge the block without reducing production')
 return columns
end
function options.product_settings(problem,pack,item)
 local result={}
 if problem.logistics.outputSlots~=(pack.chests[problem.logistics.provider].capacity or 48) then result.bar=problem.logistics.outputSlots end
 if pack.chests[problem.logistics.provider].mode=='storage' then
  result.request_filters={sections={{index=1,filters={{index=1,type='item',name=item,quality='normal',comparator='=',count=0}}}}}
 end
 return result
end
return options
