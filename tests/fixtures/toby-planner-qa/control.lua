-- Disposable native QA only: researches technologies and merges test forces.
-- Never enable this fixture on a live server or an original save.
local function prepare()
 local player=game.get_player(1)
 assert(player,'QA requires a retained player in this disposable save')
 player.force.research_all_technologies()
 local args={'player',player.name,'nauvis',{{name='iron-plate',type='item',perMinute=600}},{{name='iron-plate',machine='stone-furnace'}},{{name='iron-ore',type='item',perMinute=300,mode='maximum'}},{name='iron-plate',type='item'}}
 local result=remote.call('facmandu-toby-planner','solve',table.unpack(args))
 local saved=remote.call('facmandu-toby-planner','create_plan',args[1],args[2],args[3],'Supply test',args[4],args[5],args[6],args[7])
 storage.planId=saved.planId
 remote.call('facmandu-toby-planner','open_plan','player',player.name,storage.planId)
 local packed=remote.call('facmandu-toby-planner','export_current_factory',player.index)
 assert(packed.inputs[1].amount==5 and packed.maximize_product.name=='iron-plate')
 assert(result.status=='solved',result.status)
 assert(math.abs(result.products[1].perMinute-300)<0.001,helpers.table_to_json(result))
 assert(result.planner=='toby')
 local fixed=remote.call('facmandu-toby-planner','solve','player',player.name,'nauvis',{{name='iron-plate',type='item',machineCount=10}},{{name='iron-plate',machine='stone-furnace'}})
 assert(fixed.status=='solved' and math.abs(fixed.lines[1].machines-10)<0.001,helpers.table_to_json(fixed))
 remote.call('facmandu-toby-planner','open',player.index)
 assert(player.gui.screen.toby_planner_frame_main_dialog)
 remote.call('facmandu-assistant','open_player',player.index)
 assert(player.gui.screen['facmandu-toby-panel'])
 log('TOBY_PLANNER_NATIVE_OK '..helpers.table_to_json{inputOutput=result.products,machineCount=fixed.lines[1].machines})
end
local checked=false
local merged_id
script.on_nth_tick(5,function()
 -- Newly added fixture mods initialize before an existing planner's migration.
 if not storage.planId then prepare();return end
 if storage.qa_done then
  if not checked then
   checked=true
   local player=game.get_player(1)
   local plan=remote.call('facmandu-toby-planner','read_plan','player',player.name,storage.planId)
   assert(math.abs(plan.products[1].perMinute-240)<.001 and plan.factory.inputs[1].amount==4)
   if storage.capacityId then
    local capacity=remote.call('facmandu-toby-planner','read_plan','player',player.name,storage.capacityId)
    assert(capacity.status=='solved' and math.abs(capacity.products[1].perMinute-10)<.001)
    assert(capacity.lines[1].constraint.mode=='maximum' and capacity.lines[1].constraint.count==2)
    assert(capacity.lines[1].modules[1].count==2 and capacity.lines[1].beacon.modules[1].count==2)
    assert(capacity.lines[1].lineId==storage.capacityLineId)
    assert(capacity.factory.top_floor.lines[1].class=='Floor' and capacity.factory.top_floor.lines[1].level==2)
   end
   local book=remote.call('facmandu-assistant','export_book','player',player.name)
   local decoded=helpers.json_to_table(helpers.decode_string(book:sub(2)))
   local project
   for _,entry in ipairs(decoded.blueprint_book.blueprints) do if entry.blueprint_book.label=='Iron supply' then project=entry.blueprint_book;break end end
   assert(project,'Retained Iron supply project is missing')
   log('TOBY_PLAN_AND_BOOK_RELOAD_OK')
  end
  return
 end
 if checked then
  if merged_id then
   local player=game.get_player(1)
   assert(player.force.name=='player')
   assert(remote.call('facmandu-toby-planner','open_plan','player',player.name,storage.planId))
   assert(remote.call('facmandu-toby-planner','open_plan','player',player.name,merged_id))
   merged_id=nil
   log('TOBY_FORCE_OWNERSHIP_AND_MERGE_OK')
   local created=remote.call('facmandu-toby-planner','create_plan','player',player.name,'nauvis','Retry test',{{name='iron-plate',type='item',perMinute=60}},{{name='iron-plate',machine='stone-furnace'}},nil,nil,'qa-request')
   local retried=remote.call('facmandu-toby-planner','create_plan','player',player.name,'nauvis','Retry test',{{name='iron-plate',type='item',perMinute=60}},{{name='iron-plate',machine='stone-furnace'}},nil,nil,'qa-request')
   assert(created.planId==retried.planId)
   assert(not pcall(remote.call,'facmandu-toby-planner','create_plan','player',player.name,'nauvis','Changed retry',{{name='iron-plate',type='item',perMinute=60}},{{name='iron-plate',machine='stone-furnace'}},nil,nil,'qa-request'))
   local plan=remote.call('facmandu-toby-planner','read_plan','player',player.name,storage.planId)
   assert(plan.reference=='toby://plan/'..player.force.index..'/'..storage.planId)
   assert(plan.factory.inputs[1].amount==5)
   local result=remote.call('facmandu-toby-planner','set_inputs','player',player.name,storage.planId,plan.revision,{{name='iron-ore',type='item',perMinute=240,mode='maximum'}},{name='iron-plate',type='item'})
   assert(result.revision>plan.revision and math.abs(result.products[1].perMinute-240)<.001)
   assert(not pcall(remote.call,'facmandu-toby-planner','set_inputs','player',player.name,storage.planId,plan.revision,{},nil))
   local capacity=remote.call('facmandu-toby-planner','create_plan','player',player.name,'nauvis','Line capacity',
    {{name='iron-plate',type='item',perMinute=600}},{{name='iron-plate',machine='stone-furnace',constraint={count=2,mode='maximum'}}},
    {{name='iron-ore',type='item',perMinute=300,mode='maximum'}},{name='iron-plate',type='item'})
   local capped=remote.call('facmandu-toby-planner','read_plan','player',player.name,capacity.planId)
   assert(capped.status=='solved' and math.abs(capped.lines[1].machines-2)<.001)
   storage.capacityId=capacity.planId
   local selected_before=helpers.table_to_json(remote.call('toby-planner-interface','export_current_factory',player.index))
   local line_id=capped.lines[1].lineId
   storage.capacityLineId=line_id
   local edited=remote.call('facmandu-toby-planner','edit_line','player',player.name,capacity.planId,capped.revision,line_id,
    {machine='electric-furnace',quality='normal',modules={{name='speed-module',count=2}},
     beacon={name='beacon',count=1,modules={{name='speed-module',count=2}}},constraint={count=2,mode='exact'}})
   assert(edited.revision>capped.revision and edited.lines[1].lineId==line_id and edited.lines[1].machine=='electric-furnace')
   assert(edited.lines[1].modules[1].count==2 and edited.lines[1].beacon.count==1 and edited.lines[1].beacon.modules[1].name=='speed-module')
   assert(math.abs(edited.lines[1].machines-2)<.001)
   local baseline=2*60*prototypes.entity['electric-furnace'].get_crafting_speed()/prototypes.recipe['iron-plate'].energy
   assert(edited.products[1].perMinute>=baseline*1.4-.001,helpers.table_to_json(edited))
   local before=helpers.table_to_json(edited)
   assert(not pcall(remote.call,'facmandu-toby-planner','edit_line','player',player.name,capacity.planId,edited.revision,line_id,{modules={{name='speed-module',count=3}}}))
   assert(not pcall(remote.call,'facmandu-toby-planner','edit_line','player',player.name,capacity.planId,capped.revision,line_id,{constraint=false}))
   assert(not pcall(remote.call,'facmandu-toby-planner','edit_line','enemy',player.name,capacity.planId,edited.revision,line_id,{constraint=false}))
   assert(before==helpers.table_to_json(remote.call('facmandu-toby-planner','read_plan','player',player.name,capacity.planId)))
   local shortage=remote.call('facmandu-toby-planner','set_inputs','player',player.name,capacity.planId,edited.revision,
    {{name='iron-ore',type='item',perMinute=10,mode='maximum'}},{name='iron-plate',type='item'})
   assert(shortage.status=='no_solution')
   local feasible=remote.call('facmandu-toby-planner','edit_line','player',player.name,capacity.planId,shortage.revision,line_id,
    {constraint={count=2,mode='maximum'}})
   assert(feasible.status=='solved' and math.abs(feasible.products[1].perMinute-10)<.001 and feasible.lines[1].machines<2)
   local nested=remote.call('facmandu-toby-planner','nest_line','player',player.name,capacity.planId,feasible.revision,line_id)
   assert(nested.status=='solved' and nested.lines[1].lineId==line_id and nested.lines[1].floorId~=feasible.lines[1].floorId)
   assert(math.abs(nested.products[1].perMinute-10)<.001 and nested.lines[1].machines<2)
   local nested_exact=remote.call('facmandu-toby-planner','edit_line','player',player.name,capacity.planId,nested.revision,line_id,{constraint={count=2,mode='exact'}})
   assert(nested_exact.status=='no_solution')
   feasible=remote.call('facmandu-toby-planner','edit_line','player',player.name,capacity.planId,nested_exact.revision,line_id,{constraint={count=2,mode='maximum'}})
   assert(feasible.status=='solved')
   assert(selected_before==helpers.table_to_json(remote.call('toby-planner-interface','export_current_factory',player.index)))
   local retargeted=remote.call('facmandu-toby-planner','set_products','player',player.name,capacity.planId,feasible.revision,{{name='iron-plate',type='item',perMinute=20}})
   assert(retargeted.revision>feasible.revision and retargeted.factory.maximize_product.name=='iron-plate')
   local steam=remote.call('facmandu-toby-planner','solve','player',player.name,'nauvis',{{name='steam',type='fluid',temperature=165,perMinute=1200}},{{name=table.concat({'impostor-boil','water',prototypes.fluid.water.default_temperature,math.min(prototypes.fluid.water.max_temperature,165),'steam',165},'-'),machine='boiler'}})
   assert(steam.status=='solved' and steam.products[1].temperature==165 and math.abs(steam.products[1].perMinute-1200)<.001,helpers.table_to_json(steam))
   local water=0;for _,row in ipairs(steam.ingredients) do if row.name=='water' then water=water+row.perMinute end end
   local expected_water=1200*prototypes.fluid.steam.heat_capacity/prototypes.fluid.water.heat_capacity
   assert(math.abs(water-expected_water)<.001,helpers.table_to_json(steam))
   local steam_recipe=steam.lines[1].recipe
   local boiler=remote.call('facmandu-toby-planner','create_plan','player',player.name,'nauvis','Temperature supply',
    {{name='steam',type='fluid',temperature=165,perMinute=1200}},{{name=steam_recipe,machine='boiler',temperatures={water=15}}},
    {{name='water',type='fluid',temperature=15,perMinute=expected_water/2,mode='exact'}},{name='steam',type='fluid',temperature=165})
   assert(boiler.status=='solved' and math.abs(boiler.products[1].perMinute-600)<.001)
   local boiler_read=remote.call('facmandu-toby-planner','read_plan','player',player.name,boiler.planId)
   local boiler_before=helpers.table_to_json(boiler_read)
   assert(not pcall(remote.call,'facmandu-toby-planner','edit_line','player',player.name,boiler.planId,boiler_read.revision,boiler_read.lines[1].lineId,{temperatures={water=999}}))
   assert(boiler_before==helpers.table_to_json(remote.call('facmandu-toby-planner','read_plan','player',player.name,boiler.planId)))
   log('TOBY_TEMPERATURED_BOILER_OK '..helpers.table_to_json(steam))
   log('TOBY_LINE_CAPACITY_AND_TRANSACTIONAL_EDIT_OK')
   local inventory=game.create_inventory(1)
   inventory[1].set_stack('blueprint')
   inventory[1].set_blueprint_entities{{entity_number=1,name='transport-belt',position={x=0,y=0}}}
   local blueprint=inventory[1].export_stack()
   inventory[1].set_blueprint_entities{{entity_number=1,name='stone-furnace',position={x=0,y=0}}}
   local second=inventory[1].export_stack();inventory.destroy()
   remote.call('facmandu-assistant','update_player',player.index,{status='Routing supply belts',answer='Current plan: '..plan.reference,current='qa-running',running=true,
    chats={{id='qa-running',title='Iron supply',state='running',status='Routing supply belts',author=player.name},{id='qa-done',title='Green circuits',state='done',status='Blueprint ready',author=player.name},{id='qa-error',title='Oil refining',state='error',status='Needs an unlocked recipe',author=player.name}},
    messages={{role='user',text='Build from '..plan.reference},{role='assistant',text='The shared plan can produce 240 plates/min. I am connecting the supply.'}},
    activity={{text='Read shared factory plan'},{text='Validated iron supply cap'}},blueprint=blueprint,design='Iron smelting',designStage='Validated draft',
    force='player',blueprints={{id=string.rep('a',64),designId=string.rep('1',64),chatId='qa-running',title='Iron supply',label='Supply belts',blueprint=blueprint},{id=string.rep('b',64),designId=string.rep('2',64),chatId='qa-running',title='Iron supply',label='Smelters',blueprint=second}}})
   local exported=remote.call('facmandu-assistant','export_book','player',player.name)
   local decoded=helpers.json_to_table(helpers.decode_string(exported:sub(2)))
   local project
   for _,entry in ipairs(decoded.blueprint_book.blueprints) do if entry.blueprint_book.label=='Iron supply' then project=entry.blueprint_book;break end end
   assert(project,'Retained Iron supply project is missing')
   local designs=project.blueprints
   assert(#designs==2 and designs[1].blueprint.label=='Supply belts' and designs[2].blueprint.label=='Smelters')
   log('TOBY_MULTI_DESIGN_BOOK_OK')
   local function deliver(rows)
    return remote.call('facmandu-assistant','update_player',player.index,{status='Ready',answer='',force='player',
     current='qa-running',chats={{id='qa-running',title='Iron supply'}},blueprints=rows})
   end
   local function revision(id,design,parent,label,chat)
    return {id=string.rep(id,64),designId=string.rep(design,64),revisionOf=parent and string.rep(parent,64),
     chatId=chat or 'qa-running',title='Iron supply',label=label,blueprint=blueprint}
   end
   assert(#deliver{revision('d','4','3','Latest supply'),revision('c','3','1','Earlier supply')}.blueprints==2)
   assert(#deliver{revision('a','1',nil,'Supply belts'),revision('c','3','1','Earlier supply')}.blueprints==2)
   local revised=remote.call('facmandu-assistant','export_book','player',player.name)
   local revision_data=helpers.json_to_table(helpers.decode_string(revised:sub(2)))
   local found_latest,found_module=0,0
   for _,entry in ipairs(revision_data.blueprint_book.blueprints) do
    if entry.blueprint_book.label=='Iron supply' then
     assert(#entry.blueprint_book.blueprints==2,'Revision duplicated the saved module')
     for _,item in ipairs(entry.blueprint_book.blueprints) do
      if item.blueprint.label=='Latest supply' then found_latest=found_latest+1 end
      if item.blueprint.label=='Smelters' then found_module=found_module+1 end
     end
    end
   end
   assert(found_latest==1 and found_module==1)
   assert(#deliver{revision('e','5','4','Wrong chat','other-chat')}.blueprints==0)
   assert(revised==remote.call('facmandu-assistant','export_book','player',player.name))
   local malformed=revision('e','5','4','Invalid ancestry');malformed.revisionOf='invalid'
   assert(not pcall(deliver,{malformed}))
   deliver({})
   exported=revised
   log('TOBY_BOOK_REVISION_LINEAGE_OK')
   inventory=game.create_inventory(1);assert(inventory[1].import_stack(exported)==0);inventory.destroy()
   player.set_controller{type=defines.controllers.god}
   assert(remote.call('facmandu-assistant','take_book','player',player.name,false))
   local held=helpers.json_to_table(helpers.decode_string(player.cursor_stack.export_stack():sub(2)))
   local held_count=#held.blueprint_book.blueprints
   held.blueprint_book.label='User renamed book'
   held.blueprint_book.blueprints[1].blueprint_book.label='My edited project'
   assert(player.cursor_stack.import_stack('0'..helpers.encode_string(helpers.table_to_json(held)))==0)
   assert(remote.call('facmandu-assistant','take_book','player',player.name,true))
   local updated=helpers.json_to_table(helpers.decode_string(player.cursor_stack.export_stack():sub(2)))
   assert(updated.blueprint_book.label=='User renamed book')
   assert(updated.blueprint_book.blueprints[1].blueprint_book.label=='My edited project')
   assert(#updated.blueprint_book.blueprints==held_count+1)
   remote.call('facmandu-assistant','attach_plan' ,player.index,storage.planId)
   assert(player.gui.screen['facmandu-toby-panel'])
   storage.qa_done=true
   if game.is_multiplayer() then game.server_save('toby-planner-qa') end
   log('TOBY_SHARED_PLAN_REFERENCE_AND_BOOK_OK')
   game.take_screenshot{player=player,resolution=player.display_resolution,show_gui=true,path='toby-harness.png',force_render=true}
   game.set_wait_for_screenshots_to_finish()

  end
  return
 end
 checked=true
 local player=game.get_player(1)
 local original=player.force
 remote.call('facmandu-toby-planner','open_plan',original.name,player.name,storage.planId)
 local packed=remote.call('facmandu-toby-planner','export_current_factory',player.index)
 assert(packed.inputs[1].amount==5 and packed.maximize_product.name=='iron-plate')
 local foreign=game.create_force('QA-other')
 foreign.research_all_technologies()
 player.force=foreign
 assert(not pcall(remote.call,'facmandu-toby-planner','open_plan',foreign.name,player.name,storage.planId))
 local saved=remote.call('facmandu-toby-planner','create_plan',foreign.name,player.name,'nauvis','Other force',{{name='iron-plate',type='item',perMinute=60}},{{name='iron-plate',machine='stone-furnace'}})
 assert(remote.call('facmandu-toby-planner','open_plan',foreign.name,player.name,saved.planId))
 merged_id=saved.planId
 game.merge_forces(foreign,original)
end)
