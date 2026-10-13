-- Disposable native QA only: researches technologies and merges test forces.
-- Never enable this fixture on a live server or an original save.
script.on_init(function()
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
end)
local checked=false
local merged_id
script.on_nth_tick(5,function()
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
   local inventory=game.create_inventory(1)
   inventory[1].set_stack('blueprint')
   inventory[1].set_blueprint_entities{{entity_number=1,name='transport-belt',position={x=0,y=0}}}
   local blueprint=inventory[1].export_stack();inventory.destroy()
   remote.call('facmandu-assistant','update_player',player.index,{status='Routing supply belts',answer='Current plan: '..plan.reference,current='qa-running',running=true,
    chats={{id='qa-running',title='Iron supply',state='running',status='Routing supply belts',author=player.name},{id='qa-done',title='Green circuits',state='done',status='Blueprint ready',author=player.name},{id='qa-error',title='Oil refining',state='error',status='Needs an unlocked recipe',author=player.name}},
    messages={{role='user',text='Build from '..plan.reference},{role='assistant',text='The shared plan can produce 240 plates/min. I am connecting the supply.'}},
    activity={{text='Read shared factory plan'},{text='Validated iron supply cap'}},blueprint=blueprint,design='Iron smelting',designStage='Validated draft'})
   local exported=remote.call('facmandu-assistant','export_book','player',player.name)
   local decoded=helpers.json_to_table(helpers.decode_string(exported:sub(2)))
   assert(decoded.blueprint_book.blueprints[1].blueprint_book.label=='Iron supply')
   inventory=game.create_inventory(1);assert(inventory[1].import_stack(exported)==0);inventory.destroy()
   player.set_controller{type=defines.controllers.god}
   assert(remote.call('facmandu-assistant','take_book','player',player.name,false))
   local held=helpers.json_to_table(helpers.decode_string(player.cursor_stack.export_stack():sub(2)))
   held.blueprint_book.label='User renamed book'
   held.blueprint_book.blueprints[1].blueprint_book.label='My edited project'
   assert(player.cursor_stack.import_stack('0'..helpers.encode_string(helpers.table_to_json(held)))==0)
   assert(remote.call('facmandu-assistant','take_book','player',player.name,true))
   local updated=helpers.json_to_table(helpers.decode_string(player.cursor_stack.export_stack():sub(2)))
   assert(updated.blueprint_book.label=='User renamed book')
   assert(updated.blueprint_book.blueprints[1].blueprint_book.label=='My edited project')
   assert(#updated.blueprint_book.blueprints==2)
   remote.call('facmandu-assistant','attach_plan' ,player.index,storage.planId)
   assert(player.gui.screen['facmandu-toby-panel'])
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
