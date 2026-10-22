local events=require('__facmandu-assistant__/events').scope('layout-ui-qa')
local artifact=require('__factoryplanner-test__/artifact')
local function find(root,action)
 for _,e in pairs(root.children) do if e.tags.toby_layout==action then return e end;local found=find(e,action);if found then return found end end
end
local function click(player,element)
 script.get_event_handler(defines.events.on_gui_click){name=defines.events.on_gui_click,player_index=player.index,element=element,button=defines.mouse_button_type.left,tick=game.tick}
end
local function run()
 local player=assert(game.players[1]);player.force.research_all_technologies()
 local api='facmandu-toby-planner';local ui='facmandu-toby-layout'
 local plan=remote.call(api,'create_plan',player.force.name,player.name,'nauvis','Layout UI QA',
  {{name='iron-gear-wheel',type='item',machineCount=10}},{{name='iron-gear-wheel',machine='assembling-machine-2'}})
 local original=remote.call(api,'read_plan',player.force.name,player.name,plan.planId)
 remote.call(api,'open_plan',player.force.name,player.name,plan.planId)
 local factory=OBJECT_INDEX[plan.planId]
 local product=assert(factory.first)
 lib.gui.open_dialog(player,{dialog='picker',modal_data={item_id=product.id,item_category='product'}})
 assert(not lib.globals.modal_data(player).modal_elements.search_textfield,'Edit picker should not create item search')
 assert(lib.globals.modal_data(player).modal_elements.item_amount_textfield.valid,'Edit picker did not open')
 assert(not GLOBAL_HANDLERS.confirm_picker_search(player),'Amount edit unexpectedly searched items')
 lib.gui.close_dialog(player,'cancel')

 assert(remote.call(ui,'open',player.index,plan.planId))
 local frame=assert(player.gui.screen['toby-layout-frame'])
 assert(not player.gui.screen.toby_planner_frame_main_dialog.visible)
 local refs=storage.layouts.viewers[player.index].refs
 assert(refs.inputs.selected_index==2 and refs.intermediates.selected_index==1 and refs.outputs.selected_index==2,'Separate transport defaults are missing')
 assert(refs.robots.visible,'Requester input settings are hidden')
 refs.intermediates.selected_index=2
 script.get_event_handler(defines.events.on_gui_selection_state_changed){name=defines.events.on_gui_selection_state_changed,player_index=player.index,element=refs.intermediates,tick=game.tick}
 assert(storage.layouts.viewers[player.index].dirty,'Transport edit did not invalidate the preview')
 assert(refs.tiers.belt and not refs.tiers.underground and not refs.tiers.splitter and not refs.custom,'Layout exposes individual belt parts or manual inserter geometry')
 refs.width.text='101';refs.height.text='64'
 script.get_event_handler(defines.events.on_gui_text_changed){name=defines.events.on_gui_text_changed,player_index=player.index,element=refs.width,tick=game.tick}
 click(player,refs.generate)
 assert(refs.status.caption:find('8 to 100',1,true),'Layout validation error was hidden by draft status')
 refs.width.text='73'
 assert(remote.call(ui,'open',player.index,plan.planId) and refs.width.text=='73','Reopen replaced the draft')
 local id=remote.call(ui,'generate',player.index)
 local w=storage.layouts.forces[player.force.index][plan.planId]
 assert(w.settings.transport.inputs=='requester-chests' and w.settings.transport.intermediates=='buffer-chests' and w.settings.transport.outputs=='storage-chests','Transport choices were coupled')
 assert(w.settings.inserters==nil and w.settings.tiers.underground==nil and w.settings.tiers.splitter==nil)
 remote.call(ui,'complete',player.name,id,plan.planId,{error='[{"code":"custom","message":"Choose a larger block","path":[]}]'})
 assert(refs.status.caption=='Choose a larger block','Validation JSON leaked into the layout UI')
 id=remote.call(ui,'generate',player.index)
 assert(w.settings.width==73 and w.revision==original.revision)
 assert(not refs.take.enabled and refs.cancel.visible)
 -- Offline benchmark players cannot claim work, even with a real request ID.
 if not player.connected then assert(not remote.call(ui,'read_request',player.name,id,plan.planId)) end
 assert(not remote.call(ui,'complete',player.name,'wrong',plan.planId,{error='wrong'}))
 assert(remote.call(ui,'complete',player.name,id,plan.planId,artifact),w.error)
 assert(refs.camera.visible and refs.take.enabled and not refs.empty.visible)
 assert(w.entityCount==#artifact.entities and w.blueprintRevision==original.revision)
 local surface=assert(game.surfaces[w.surface]);assert(#surface.find_entities_filtered{type='entity-ghost'}==#artifact.entities)
 for _,e in pairs(surface.find_entities()) do assert(e.type=='entity-ghost','A preview created a real entity') end
 local before=helpers.table_to_json(remote.call(api,'read_plan',player.force.name,player.name,plan.planId))
 assert(before==helpers.table_to_json(original),'Layout modified the production plan')
 assert(#storage.books[player.force.index]>0)
 -- Cursor delivery is the same button callback used by a real player.
 click(player,refs.take)
 assert(player.cursor_stack.valid_for_read and player.cursor_stack.is_blueprint)
 assert(#player.cursor_stack.get_blueprint_entities()==#artifact.entities)
 remote.call(ui,'open',player.index,plan.planId);refs=storage.layouts.viewers[player.index].refs
 assert(refs.camera.visible and refs.take.enabled)
 click(player,refs.inspect);assert(player.opened==player.cursor_stack)
 -- Stale completion cannot publish a blueprint after a planner edit.
 remote.call(ui,'open',player.index,plan.planId);refs=storage.layouts.viewers[player.index].refs
 id=remote.call(ui,'generate',player.index)
 local updated=remote.call(api,'set_products',player.force.name,player.name,plan.planId,original.revision,{{name='iron-gear-wheel',type='item',perMinute=60}})
 assert(updated.revision~=original.revision)
 assert(not remote.call(ui,'complete',player.name,id,plan.planId,artifact))
 assert(w.status=='failed')
 click(player,refs.generate);assert(w.status=='queued')
 click(player,refs.cancel);assert(w.status=='cancelled')
 assert(not remote.call(ui,'complete',player.name,w.requestId,plan.planId,artifact),'Cancelled work was accepted')
 -- Upgrade an old persisted view without duplicate GUI roots.
 storage.layouts.viewers[player.index].version=nil
 w.settings.transport='robots'
 remote.call(ui,'open',player.index,plan.planId);refs=storage.layouts.viewers[player.index].refs
 assert(refs.intermediates.selected_index==2 and not refs.take.enabled,'Legacy layout was not safely migrated')
 -- Opening a second layout removes the previous root; closing returns to its plan.
 for _=1,3 do click(player,find(refs.frame,'back'));remote.call(ui,'open',player.index,plan.planId);refs=storage.layouts.viewers[player.index].refs end
 return {passed=true,version=script.active_mods['facmandu-assistant'],previewEntities=#artifact.entities,
  preservedPlan=true,cursorDelivery=true,staleRejected=true,cancellation=true,bookSaved=true,retainedDraft=true,previewSurface=w.surface}
end
local began=false
local function retained()
 local proof=storage.layout_ui_qa_result
 local surface=assert(game.surfaces[proof.previewSurface])
 assert(surface.get_tile(0,0).valid,'Preview terrain disappeared after a tick')
 assert(#surface.find_entities_filtered{type='entity-ghost'}==proof.previewEntities,'Preview entities disappeared after a tick')
end
local function write(proof)
 helpers.write_file('toby-layout-ui-qa.json',helpers.table_to_json(proof),false);log('TOBY_LAYOUT_UI_QA '..helpers.table_to_json(proof))
end
events.on_nth_tick(1,function()
 if storage.layout_ui_qa_done then
  if not began then
   began=true
   local ok,err=pcall(retained)
   write(ok and {passed=true,reloaded=true,version=script.active_mods['facmandu-assistant']} or {passed=false,error=tostring(err)})
  end
  return
 end
 if storage.layout_ui_qa_result then
  if game.tick-storage.layout_ui_qa_tick<90 then return end
  local ok,err=pcall(function()
   retained()
   local player=game.players[1]
   local peer=assert(game.players[2],'This copied multiplayer fixture needs two retained players');peer.force=player.force
   local id=storage.layouts.viewers[player.index].id
   assert(remote.call('facmandu-toby-planner','read_plan',player.force.name,peer.name,id).reference)
   assert(remote.call('facmandu-toby-layout','open',peer.index,id))
   -- Blueprint Sandboxes synchronously clones the entire pack's research on force changes.
   -- The vanilla run covers this boundary; the full pack covers shared access and rendering.
   if not script.active_mods['blueprint-sandboxes'] then
    local foreign=game.create_force('layout-ui-foreign-qa');peer.force=foreign
    assert(not pcall(remote.call,'facmandu-toby-layout','open',peer.index,id),'Foreign force opened the layout')
    peer.force=player.force
   end
  end)
  storage.layout_ui_qa_done=true
  local proof=ok and storage.layout_ui_qa_result or {passed=false,error=tostring(err)}
  proof.sharedForce=ok;proof.delayedPreview=ok;write(proof)
  if ok then game.auto_save('toby-layout-ui-qa') end
  return
 end
 began=true
 local ok,result=pcall(run)
 if ok then storage.layout_ui_qa_result=result;storage.layout_ui_qa_tick=game.tick
 else storage.layout_ui_qa_done=true;write{passed=false,error=tostring(result)} end
end)
return function() end
