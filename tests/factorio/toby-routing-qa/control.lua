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
   for _,e in ipairs(surface.find_entities_filtered{area={{-1,-4},{12,15}},type={'tree','simple-entity'}}) do e.destroy() end
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
   log('TOBY_ROUTING_PATH '..helpers.table_to_json(result.entities))
   local entrance,exit
   for _,spec in ipairs(result.entities) do
    spec.force=p.force
    local e=assert(p.surface.create_entity(spec))
    if spec.type=='input' then entrance=e elseif spec.type=='output' then exit=e end
   end
   assert(entrance and exit,'The wall crossing needs an underground pair')
   assert(entrance.underground_belt_neighbour==exit,'The native underground pair did not connect')
   assert(p.insert{name='iron-plate',count=2}==2)
   assert(p.remove_item{name='iron-plate',count=2}==2)
   assert(source.get_transport_line(1).insert_at_back{name='iron-plate',count=1})
   assert(source.get_transport_line(2).insert_at_back{name='iron-plate',count=1})
   storage.source=source;storage.destination=destination;storage.started=game.tick
   storage.result={found=true,entities=#result.entities,visited=result.visited,undergroundPaired=true,sourcePreserved=true,destinationPreserved=true}
   storage.stage='flow'
  elseif storage.stage=='flow' and game.tick-storage.started>=480 then
   local e=storage.destination
   local left=e.get_transport_line(1).get_item_count('iron-plate')
   local right=e.get_transport_line(2).get_item_count('iron-plate')
   assert(left==1 and right==1,'Both routed lanes must deliver their test plate')
   storage.result.leftDelivered=left;storage.result.rightDelivered=right;storage.result.passed=true
   record(storage.result);storage.stage='done'
  end
 end)
 if not ok then record({passed=false,error=tostring(message)});storage.stage='done' end
end)
