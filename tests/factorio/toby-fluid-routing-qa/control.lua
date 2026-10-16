-- Synthetic pipes and fluids belong only to this disposable native fixture.
-- Run in a game copy with native chart updates, not an empty benchmark save.
local route=require('scripts.tools.fluid_route').functions.route_pipe
local function record(row)
 helpers.write_file('toby-fluid-routing-qa.json',helpers.table_to_json(row),false)
 log('TOBY_FLUID_ROUTING_QA '..helpers.table_to_json(row))
end
local function create(s,name,x,y,d)
 return assert(s.create_entity{name=name,position={x=x,y=y},direction=d or 0,force=game.forces.player})
end
script.on_init(function()
 local s=game.create_surface('toby-fluid-routing-qa',{default_enable_all_autoplace_controls=false,autoplace_settings={entity={treat_missing_as_default=false},tile={treat_missing_as_default=false},decorative={treat_missing_as_default=false}}})
 s.request_to_generate_chunks({0,0},3);s.force_generate_chunk_requests()
 local tiles={};for x=-32,63 do for y=-32,63 do tiles[#tiles+1]={name='grass-1',position={x=x,y=y}}end end
 s.set_tiles(tiles);create(s,'pipe',-16.5,-16.5);game.forces.player.chart(s,{{-32,-32},{63,63}})
 storage.started=game.tick
end)
script.on_nth_tick(10,function()
 if storage.done then return end
 local ok,message=pcall(function()
  local s=game.surfaces['toby-fluid-routing-qa'];local f=game.forces.player
  local function request(x,y,tx,ty)
   return {force=f.name,surface=s.name,pipe='pipe',underground='pipe-to-ground',fluid='water',x=x,y=y,target_x=tx,target_y=ty,margin=3}
  end
  if not storage.designed then
   if not storage.chartRequested then f.chart(s,{{-32,-32},{63,63}});storage.chartRequested=true;return end
   if not f.is_chunk_charted(s,{0,0}) then assert(game.tick-storage.started<600,'Native charting did not complete');return end
   local destinations={}
   for _,axis in ipairs{'x','y'} do
    local x,y=axis=='x' and .5 or 24.5,.5
    local tx,ty=axis=='x' and 8.5 or 24.5,axis=='x' and .5 or 8.5
    create(s,'pipe',x,y).insert_fluid{name='water',amount=100}
    local dest=create(s,'pipe',tx,ty);destinations[#destinations+1]=dest
    for offset=-3,3 do create(s,'stone-wall',axis=='x' and 4.5 or 24.5+offset,axis=='x' and .5+offset or 4.5) end
    local a=request(x,y,tx,ty);a.margin=1
    local result=route(a);assert(result.found,result.note)
    local pairs=0
    for _,e in ipairs(result.entities) do
     assert(e.name=='pipe-to-ground','The wall crossing needs only an underground pair')
     assert(s.can_place_entity{name=e.name,position=e.position,direction=e.direction,force=f},'Native pipe collision')
     create(s,e.name,e.position.x,e.position.y,e.direction);pairs=pairs+1
    end
    assert(pairs==2)
   end
   local source=create(s,'pipe',.5,16.5);source.insert_fluid{name='water',amount=100}
   local target=create(s,'pipe',12.5,16.5);destinations[#destinations+1]=target
   local foreign=create(s,'pipe',6.5,16.5);foreign.insert_fluid{name='sulfuric-acid',amount=100}
   local avoid=route(request(.5,16.5,12.5,16.5));assert(avoid.found,avoid.note)
   for _,e in ipairs(avoid.entities) do create(s,e.name,e.position.x,e.position.y,e.direction) end
   storage.foreign=foreign
   local wrong=request(.5,16.5,6.5,16.5)
   assert(not pcall(route,wrong),'A different endpoint fluid must be rejected')
   target.order_deconstruction(f)
   assert(not pcall(route,request(.5,16.5,12.5,16.5)),'Marked endpoints are not continuing supplies')
   assert(target.to_be_deconstructed(),'Routing must not cancel player deconstruction')
   target.cancel_deconstruction(f)
   assert(not pcall(route,request(.5,16.5,96.5,96.5)),'Uncharted endpoints must not be read')
   local unknown=request(.5,24.5,12.5,24.5)
   unknown.obstacles={{name='chemical-plant',position={x=12.5,y=26.5},direction=0}}
   assert(not route(unknown).found,'Unverified future fluid ports must remain isolated')
   local enemy=create(s,'pipe',40.5,16.5);enemy.force=game.forces.enemy
   assert(not route(request(.5,16.5,40.5,16.5)).found,'Another force pipe cannot be replaced')
   local plant=create(s,'chemical-plant',40.5,40.5)
   plant.set_recipe('sulfuric-acid')
   local water_port,water_index
   for index=1,plant.fluids_count do
    local filter=plant.get_fluid_filter(index)
    if filter and (filter.object_name=='LuaFluidPrototype' and filter.name or filter.fluid.name)=='water' then
     for _,port in ipairs(plant.get_fluid_box_pipe_connections(index)) do
      if port.flow_direction=='input' then water_port=port.target_position;water_index=index;break end
     end
    end
   end
   assert(water_port,'The native acid recipe needs a filtered water input')
   local inlet=create(s,'pipe',20.5,40.5)
   local wrong_port=request(20.5,40.5,water_port.x,water_port.y);wrong_port.fluid='lubricant'
   assert(not route(wrong_port).found,'An empty recipe port must still reject the wrong fluid')
   local filtered=route(request(20.5,40.5,water_port.x,water_port.y));assert(filtered.found,filtered.note)
   for _,e in ipairs(filtered.entities) do create(s,e.name,e.position.x,e.position.y,e.direction) end
   inlet.insert_fluid{name='water',amount=100};storage.plant=plant;storage.water_index=water_index
   storage.destinations=destinations;storage.designed=game.tick
  elseif game.tick-storage.designed>=120 then
   local delivered={}
   for _,e in ipairs(storage.destinations) do
    local amount=e.get_fluid_contents().water or 0
    assert(amount>0,'Generated pipe route did not deliver water')
    delivered[#delivered+1]=amount
   end
   local foreign=storage.foreign.get_fluid_contents()
   assert(foreign['sulfuric-acid']==100 and not foreign.water,'An unrelated fluid system was mixed')
   local connected=route(request(.5,.5,8.5,.5))
   assert(connected.found and #connected.entities==0,'An existing connection must not be routed again')
   local water=storage.plant.get_fluid(storage.water_index)
   assert(water and water.name=='water' and water.amount>0,'The filtered native machine port did not receive water')
   record({passed=true,delivered=delivered,filteredMachineDelivery=water.amount,undergroundDirections=true,alreadyConnected=true,foreignFluidPreserved=true,wrongFluidRejected=true,deconstructionPreserved=true,unchartedRejected=true,plannedPortsIsolated=true,otherForcePreserved=true})
   storage.done=true
  end
 end)
 if not ok then record({passed=false,error=tostring(message)});storage.done=true end
end)
