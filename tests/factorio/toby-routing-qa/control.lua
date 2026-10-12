-- Controlled entities and two iron plates are inputs to this isolated native
-- routing fixture. Never run this scenario on a player's world.
local route=require('scripts.tools.transport_route').functions.route_belt
local function record(value)
 log('TOBY_ROUTING_QA '..helpers.table_to_json(value))
 helpers.write_file('toby-routing-qa.json',helpers.table_to_json(value),false)
end
script.on_init(function() storage.stage='start';game.speed=4 end)
script.on_nth_tick(30,function()
 local p=game.connected_players[1]
 if not p or storage.stage=='done' then return end
 local ok,message=pcall(function()
  if storage.stage=='start' then
   local surface=p.surface
   surface.request_to_generate_chunks({0,0},4);surface.force_generate_chunk_requests()
   local tiles={}
   for x=-16,112 do for y=-16,24 do tiles[#tiles+1]={name='grass-1',position={x=x,y=y}} end end
   surface.set_tiles(tiles)
   p.force.chart(surface,{{-16,-16},{112,24}});p.teleport({-10,-10})
   for _,e in ipairs(surface.find_entities_filtered{area={{-16,-16},{112,24}},type={'tree','simple-entity'}}) do e.destroy() end
   local source=assert(surface.create_entity{name='transport-belt',position={0.5,0.5},direction=4,force=p.force})
   local destination=assert(surface.create_entity{name='transport-belt',position={8.5,0.5},direction=4,force=p.force})
   for y=-3,3 do assert(surface.create_entity{name='stone-wall',position={4.5,y+0.5},force=p.force}) end
   local args={force=p.force.name,surface=surface.name,belt='transport-belt',x=0.5,y=0.5,target_x=8.5,target_y=0.5,margin=1}
   storage.source=source;storage.destination=destination;storage.args=args;storage.started=game.tick
   storage.stage='design'
  elseif storage.stage=='design' then
   local args=storage.args
   local source,destination=storage.source,storage.destination
   assert(game.tick-storage.started<=120,'Native charting did not complete')
   if not p.force.is_chunk_charted(p.surface,{0,0}) then return end
   assert(route(args).found==false)
   args.underground='underground-belt'
   local result=route(args)
   assert(result.found and result.start.unit_number==source.unit_number and result.destination.unit_number==destination.unit_number)
   local waypoint=route{force=p.force.name,surface=p.surface.name,belt='transport-belt',underground='underground-belt',x=0.5,y=0.5,target_x=7.5,target_y=0.5,margin=1}
   assert(waypoint.found and waypoint.entities[#waypoint.entities].name=='transport-belt','A route section must end after its underground exit')
   log('TOBY_ROUTING_PATH '..helpers.table_to_json(result.entities))
   local entrance,exit
   for _,spec in ipairs(result.entities) do
    spec.force=p.force
    local e=assert(p.surface.create_entity(spec))
    if spec.type=='input' then entrance=e elseif spec.type=='output' then exit=e end
   end
   assert(entrance and exit,'The wall crossing needs an underground pair')
   assert(entrance.underground_belt_neighbour==exit,'The native underground pair did not connect')
   local open=route{force=p.force.name,surface=p.surface.name,belt='transport-belt',x=20.5,y=8.5,target_x=80.5,target_y=20.5,margin=1}
   assert(open.found and #open.entities==73)
   local turns=0
   for i=2,#open.entities do if open.entities[i].direction~=open.entities[i-1].direction then turns=turns+1 end end
   assert(turns==1,'The empty route should have one corner')
   local planned_source={name='transport-belt',position={20.5,0.5},direction=4}
   local planned_destination={name='transport-belt',position={36.5,0.5},direction=4}
   local planned_plant={name='assembling-machine-1',position={28.5,0.5}}
   local around=route{force=p.force.name,surface=p.surface.name,belt='transport-belt',x=20.5,y=0.5,target_x=36.5,target_y=0.5,margin=3,obstacles={
    {name=planned_source.name,position={x=20.5,y=0.5},direction=4},
    {name=planned_destination.name,position={x=36.5,y=0.5},direction=4},
    {name=planned_plant.name,position={x=28.5,y=0.5}}
   }}
   assert(around.found and around.plannedStart and around.plannedDestination)
   assert(not around.start and not around.destination,'Planned endpoints must remain distinct from live endpoints')
   planned_source.force=p.force;planned_destination.force=p.force;planned_plant.force=p.force
   assert(p.surface.create_entity(planned_source));assert(p.surface.create_entity(planned_destination));assert(p.surface.create_entity(planned_plant))
   for _,spec in ipairs(around.entities) do
    spec.force=p.force
    assert(p.surface.can_place_entity{name=spec.name,position=spec.position,direction=spec.direction,force=p.force,build_check_type=defines.build_check_type.manual},'Route collided with a planned entity')
    assert(p.surface.create_entity(spec))
   end
   assert(p.insert{name='iron-plate',count=2}==2)
   assert(p.remove_item{name='iron-plate',count=2}==2)
   assert(source.get_transport_line(1).insert_at_back{name='iron-plate',count=1})
   assert(source.get_transport_line(2).insert_at_back{name='iron-plate',count=1})
   storage.source=source;storage.destination=destination;storage.started=game.tick
   storage.result={found=true,entities=#result.entities,visited=result.visited,freeRouteEntities=#open.entities,freeRouteTurns=turns,surfaceSectionJoin=true,plannedObstaclesAvoided=true,plannedEndpointsPreserved=true,undergroundPaired=true,sourcePreserved=true,destinationPreserved=true}
   storage.stage='flow'
  elseif storage.stage=='flow' and game.tick-storage.started>=480 then
   local e=storage.destination
   local left=e.get_transport_line(1).get_item_count('iron-plate')
   local right=e.get_transport_line(2).get_item_count('iron-plate')
   assert(left==1 and right==1,'Both routed lanes must deliver their test plate')
   storage.result.leftDelivered=left;storage.result.rightDelivered=right;storage.result.passed=true
   if remote.interfaces['facmandu-assistant'] then
    local inventory=game.create_inventory(1)
    local stack=inventory[1];stack.set_stack{name='blueprint'}
    stack.set_blueprint_entities{
     {entity_number=1,name='transport-belt',position={1.5,0.5},direction=4},
     {entity_number=2,name='underground-belt',position={2.5,0.5},direction=4,type='input'},
     {entity_number=3,name='underground-belt',position={7.5,0.5},direction=4,type='output'}
    }
    stack.label='Native routing fixture'
    local encoded=stack.export_stack();inventory.destroy()
    remote.call('facmandu-assistant','open_player',p.index)
    remote.call('facmandu-assistant','update_player',p.index,{
     status='Isolated routing test passed',answer='',current='routing-qa',running=false,
     chats={{id='routing-qa',title='Native routing test'}},
     messages={{role='user',text='Check the underground crossing.'},{role='assistant',text='Both belt lanes delivered their test plate through the crossing. The source and destination belts were preserved.'}},
     activity={{text='3 connection entities · Underground pair connected'},{text='Left lane: 1 delivered · Right lane: 1 delivered'},{text='Planned machines avoided · Route joins use surface belts'}},
     blueprint=encoded,design='Native routing fixture',materials={{name='transport-belt',count=1},{name='underground-belt',count=2}}
    })
   end
   record(storage.result);storage.stage='done'
  end
 end)
 if not ok then record({passed=false,error=tostring(message)});storage.stage='done' end
end)
