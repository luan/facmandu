import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('belt routing preserves endpoints, crosses obstacles with matched undergrounds and never inspects uncharted terrain', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 local force={name='player'}
 local world={};local chart={};local blocked={};local reads=0
 local belt={type='transport-belt',tile_width=1,tile_height=1,belt_speed=0.03125}
 local underground={type='underground-belt',tile_width=1,tile_height=1,belt_speed=0.03125,max_underground_distance=5}
 prototypes={entity={belt=belt,underground=underground,fast={type='underground-belt',tile_width=1,tile_height=1,belt_speed=0.0625}}}
 defines={build_check_type={manual=1}}
 local function key(x,y) return x..':'..y end
 local function known(x,y) return not chart[key(math.floor(x/32),math.floor(y/32))] end
 force.is_chunk_charted=function(_,chunk) return not chart[key(chunk.x,chunk.y)] end
 local surface={valid=true,name='nauvis'}
 surface.find_entity=function(name,p) local e=world[key(p.x,p.y)];return e and e.name==name and e or nil end
 surface.find_entities_filtered=function(q)
  local rows={}
  for _,e in pairs(world) do
   local matches=(not q.force or e.force==q.force) and (not q.name or e.name==q.name)
   if q.type then
    local type_matches=q.type==e.type
    if type(q.type)=='table' then for _,t in ipairs(q.type) do type_matches=type_matches or e.type==t end end
    matches=matches and type_matches
   end
   if q.position then matches=matches and e.position.x==q.position.x and e.position.y==q.position.y end
   if q.area then matches=matches and e.position.x>=q.area[1][1] and e.position.x<=q.area[2][1] and e.position.y>=q.area[1][2] and e.position.y<=q.area[2][2] end
   if matches then rows[#rows+1]=e end
  end
  return rows
 end
 surface.can_place_entity=function(q)
  assert(q.force==force and q.build_check_type==1 and q.forced==false)
  assert(known(q.position.x,q.position.y),'Uncharted terrain was inspected')
  reads=reads+1
  return not blocked[key(q.position.x,q.position.y)]
 end
 surface.create_entity=function() error('Routing must not place entities') end
 game={tick=1,forces={player=force},surfaces={nauvis=surface}}
 local function existing(x,y,ghost)
  local e={name=ghost and 'entity-ghost' or 'belt',ghost_name=ghost and 'belt' or nil,type=ghost and 'entity-ghost' or 'transport-belt',prototype=belt,ghost_prototype=ghost and belt or nil,position={x=x,y=y},direction=4,force=force,unit_number=x+1}
  setmetatable(e,{__index=function(_,field) error('Unknown native entity field: '..field) end})
  world[key(x,y)]=e;return e
 end
 local start=existing(0.5,0.5);local target=existing(8.5,0.5,true)
 for y=-4.5,5.5 do blocked[key(4.5,y)]=true end
 local route=require('scripts.tools.transport_route').functions.route_belt
 local args={force='player',surface='nauvis',belt='belt',x=0.5,y=0.5,target_x=8.5,target_y=0.5,margin=1}
 assert(route(args).found==false)
 args.underground='underground'
 local result=route(args);assert(result.found and result.start.unit_number==start.unit_number and result.destination.ghost)
 local entrance,exit
 local used={}
 for _,e in ipairs(result.entities) do
  assert(not used[key(e.position.x,e.position.y)] and not blocked[key(e.position.x,e.position.y)])
  used[key(e.position.x,e.position.y)]=true
  assert(e.position.x~=start.position.x or e.position.y~=start.position.y)
  assert(e.position.x~=target.position.x or e.position.y~=target.position.y)
  if e.type=='input' then entrance=e elseif e.type=='output' then exit=e end
 end
 assert(entrance and exit and entrance.direction==4 and exit.direction==4)
 assert(exit.position.x-entrance.position.x<=underground.max_underground_distance)
 local waypoint=route{force='player',surface='nauvis',belt='belt',underground='underground',x=0.5,y=0.5,target_x=7.5,target_y=0.5,margin=1}
 assert(waypoint.found and waypoint.entities[#waypoint.entities].name=='belt','A section join must retain its underground exit')
 assert(world[key(start.position.x,start.position.y)]==start and world[key(target.position.x,target.position.y)]==target)
 args.underground='fast';assert(not pcall(route,args));args.underground='underground'
 args.x=0.25;assert(not pcall(route,args));args.x=0.5
 args.target_x=600.5;assert(not pcall(route,args));args.target_x=64.5
 chart[key(1,0)]=true;chart[key(1,-1)]=true
 local frontier=route(args)
 assert(not frontier.found and reads>0 and frontier.closestApproach)
 assert(frontier.closestApproach.x<32 and known(frontier.closestApproach.x,frontier.closestApproach.y))
 assert(frontier.closestApproach.remaining>0 and frontier.closestApproach.remaining<64)
 chart[key(2,0)]=true;assert(not pcall(route,args))
 world={};blocked={};chart={}
 local open=route{force='player',surface='nauvis',belt='belt',x=0.5,y=0.5,target_x=20.5,target_y=10.5,margin=1}
 assert(open.found and #open.entities==31)
 local turns=0
 for i=2,#open.entities do if open.entities[i].direction~=open.entities[i-1].direction then turns=turns+1 end end
 assert(turns==1,'An open connection needs one corner, not a zigzag')
 prototypes.entity.plant={type='assembling-machine',tile_width=3,tile_height=3}
 local planned_args={force='player',surface='nauvis',belt='belt',x=0.5,y=0.5,target_x=10.5,target_y=0.5,margin=3,obstacles={
  {name='belt',position={x=0.5,y=0.5},direction=4},
  {name='plant',position={x=5.5,y=0.5}},
  {name='belt',position={x=10.5,y=0.5},direction=4}
 }}
 local around=route(planned_args)
 assert(around.found and around.plannedStart and around.plannedDestination)
 assert(not around.start and not around.destination,'Planned endpoints are not live entities')
 for _,e in ipairs(around.entities) do
  assert(e.position.x~=0.5 or e.position.y~=0.5)
  assert(e.position.x~=10.5 or e.position.y~=0.5)
  assert(e.position.x<4 or e.position.x>=7 or e.position.y< -1 or e.position.y>=2,'Route intersects the unplaced machine')
 end
 -- A direction-aware search used to find a self-crossing path and reject the
 -- whole connection instead of finding the clear alternative in this corridor.
 world={};blocked={};chart={}
 existing(0.5,0.5);existing(6.5,5.5)
 local random=3
 for x=-3,9 do for y=-3,8 do
  random=(random*48271.0)%2147483647
  if random%17<7 and not(x==0 and y==0) and not(x==6 and y==5) then blocked[key(x+0.5,y+0.5)]=true end
 end end
 local corridor=route{force='player',surface='nauvis',belt='belt',underground='underground',x=0.5,y=0.5,target_x=6.5,target_y=5.5,margin=3}
 assert(corridor.found,corridor.note)
 local unique={}
 for _,entity in ipairs(corridor.entities) do
  local tile=key(entity.position.x,entity.position.y)
  assert(not unique[tile] and not blocked[tile],'The route overlaps itself or a building')
  unique[tile]=true
 end
 world={};blocked={};chart={}
 existing(0.5,0.5)
 local bus=existing(10.5,0.5)
 local feeder=existing(9.5,0.5)
 bus.belt_shape='straight';bus.belt_neighbours={inputs={feeder}}
 for _,lane in ipairs{'left','right'} do
  local selected=route{force='player',surface='nauvis',belt='belt',x=.5,y=.5,target_x=10.5,target_y=.5,target_lane=lane,margin=3}
  assert(selected.found and selected.destination_lane==lane)
  local last=selected.entities[#selected.entities]
  assert(last.position.x==10.5 and last.position.y==(lane=='left' and -.5 or 1.5))
  assert(last.direction==(lane=='left' and 8 or 0),'The final approach must enter the selected bus lane')
  assert(world[key(9.5,.5)]==feeder and world[key(10.5,.5)]==bus)
 end
 local lane_args={force='player',surface='nauvis',belt='belt',x=.5,y=.5,target_x=10.5,target_y=.5,target_lane='left',margin=3}
 bus.belt_shape='left';assert(not pcall(route,lane_args),'A corner cannot guarantee side loading')
 bus.belt_shape='straight';bus.belt_neighbours.inputs={};assert(not pcall(route,lane_args),'An empty belt could curve and change the destination lane')
 planned_args.obstacles[2].position.x=0/0
 assert(not pcall(route,planned_args))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('bus discovery returns actual matching lanes and distinguishes mixed cargo from throughput', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 local force={name='player',is_chunk_charted=function() return true end}
 defines={build_check_type={manual=1}}
 local belts={}
 prototypes={item={glass={}}}
 local surface={valid=true,name='nauvis'}
 surface.find_entities_filtered=function(q)
  local result={}
  for _,e in ipairs(belts) do
   if q.position and q.limit==1 then
    if e.position.x==q.position.x and e.position.y==q.position.y then result[#result+1]=e end
   elseif e.force==q.force then result[#result+1]=e end
  end
  return result
 end
 surface.can_place_entity=function() return true end
 game={forces={player=force},surfaces={nauvis=surface}}
 local function lane(y,from,to,carrying)
  local previous
  for x=from,to do
   local e={type='transport-belt',belt_neighbours={inputs=previous and {previous} or {}},force=force,belt_shape='straight',direction=4,position={x=x+0.5,y=y+0.5},unit_number=#belts+1,name='belt',prototype={belt_speed=0.03125}}
   e.get_transport_line=function(side)
    return {get_item_count=function(name)
     if carrying and side==1 then return name=='glass' and 1 or name and 0 or 2 end
     return 0
    end}
   end
   belts[#belts+1]=e;previous=e
  end
 end
 local find=require('scripts.tools.bus_discovery').functions.find_buses
 local args={force='player',surface='nauvis',x=20,y=1,product='glass'}
 lane(1,0,20,true);lane(0,0,20,false)
 -- A second disconnected run on the same lane is not a third bus lane.
 lane(1,30,50,false)
 assert(find(args).total==0)
 lane(2,0,20,false)
 local result=find(args);assert(result.total==1)
 local bus=result.candidates[1];assert(bus.laneCount==3 and bus.matchingLanes==1)
 local matched=bus.lanes[1]
 assert(matched.position==1.5 and matched.productLeft==21 and matched.productRight==0)
 assert(matched.mixedLeft==true and matched.mixedRight==false)
 assert(matched.connection.position.x==0.5 and matched.connection.position.y==1.5 and matched.connection.approachAvailable)
 assert(matched.connection.capacityPerMinute==900)
 assert(matched.connection.laneApproaches.both and not matched.connection.laneApproaches.left and not matched.connection.laneApproaches.right)
 args.product='unknown';assert(not pcall(find,args));args.product='glass'
 args.x=0/0;assert(not pcall(find,args))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
