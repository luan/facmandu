-- Only loaded into a disposable copy of the QA world.
local territories=require('__facmandu-assistant__/territory')
local inspect=require('scripts.tools.territory_inspection').functions.inspect_territory
local route=require('scripts.tools.transport_route').functions.route_belt
local blueprint=require('blueprint-qa')
script.on_init(function() storage.pending=true end)
script.on_configuration_changed(function() storage.pending=true end)
script.on_nth_tick(10,function()
 if not storage.pending then return end
 storage.pending=false
 local force=game.forces.player
 if not storage.qa_surface then
 local surface=game.create_surface('toby-territory-qa',{width=256,height=256})
 surface.generate_with_lab_tiles=true
 surface.request_to_generate_chunks({0,0},3);surface.force_generate_chunk_requests()
 force.chart(surface,{{-96,-96},{128,128}})
 storage.qa_surface=surface;storage.pending=true;return
 end
 local surface=storage.qa_surface
 force.recipes['transport-belt'].enabled=true;force.recipes['assembling-machine-1'].enabled=true
 local territory=assert(surface.create_territory{chunks={{x=1,y=0}}})
 local function guardian() return assert(surface.create_segmented_unit{name='small-demolisher',position={48,16},territory=territory}) end
 local unit=guardian()
 local survey=inspect{force=force.name,surface=surface.name,x=32,y=16,radius=32}
 log('TOBY_TERRITORY_COUNTS '..helpers.table_to_json(survey.counts))
 assert(survey.counts.guarded==1,'Native guardian must own exactly one surveyed chunk')
 assert(territories.reader(force,surface)(1,0).status=='guarded')
 local request={operation='inspect',force=force.name,surface=surface.name,position={x=0,y=0},design='native-territory-test',label='Guarded belt',entities={{name='transport-belt',position={x=0.5,y=0.5},direction=4},{name='transport-belt',position={x=32.5,y=0.5},direction=4}},tiles={},wires={}}
 local denied=blueprint(request,territories)
 assert(not denied.ready and denied.blocked[1].territory.status=='guarded')
 request.operation='place';request.expectedTick=game.tick;request.expectedDesign=request.design
 local before=surface.count_entities_filtered{type={'entity-ghost','tile-ghost'}}
 local ok,err=pcall(blueprint,request,territories)
 assert(not ok and err:find('placement forbidden',1,true))
 assert(surface.count_entities_filtered{type={'entity-ghost','tile-ghost'}}==before,'Rejected placement must be atomic')
 local cross={operation='inspect',force=force.name,surface=surface.name,position={x=0,y=0},design='crossing',label='Crossing footprint',entities={{name='assembling-machine-1',position={x=31.5,y=16.5},direction=0}},tiles={},wires={}}
 assert(blueprint(cross,territories).blocked[1].territory.status=='guarded','The full machine footprint must be checked')
 local path=route{force=force.name,surface=surface.name,belt='transport-belt',underground='underground-belt',x=30.5,y=0.5,target_x=34.5,target_y=-0.5,margin=3}
 assert(path.found,path.note)
 for _,e in ipairs(path.entities) do assert(territories.reader(force,surface)(math.floor(e.position.x/32),math.floor(e.position.y/32)).status~='guarded') end
 unit.destroy()
 local cleared=territories.reader(force,surface)(1,0).status
 assert(cleared=='cleared' or cleared=='unguarded')
 request.operation='inspect';assert(blueprint(request,territories).ready,'Defeated territory can be used')
 if not territory.valid then territory=assert(surface.create_territory{chunks={{x=1,y=0}}}) end
 unit=guardian();request.operation='place'
 assert(not pcall(blueprint,request,territories),'A guardian arriving after inspection must block placement')
 assert(surface.count_entities_filtered{type={'entity-ghost','tile-ghost'}}==before)
 local result={passed=true,version=script.active_mods['facmandu-assistant'],guardedChunks=survey.counts.guarded,footprintBlocked=true,staleInspectionBlocked=true,zeroRejectedWrites=true,routeEntities=#path.entities}
 helpers.write_file('toby-territory-qa.json',helpers.table_to_json(result),false)
 log('TOBY_TERRITORY_QA_PASS')
end)
