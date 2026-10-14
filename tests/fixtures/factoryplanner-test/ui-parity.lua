-- Dialog callbacks and native elements, using the upstream test hook on a copied world.
-- This checks editor behavior; hardware mouse/keyboard qualification is separate.
local events=require('__facmandu-assistant__/events').scope('native-editor-parity-qa')
local done=false
local finish=false
local manual_wait=false
events.on_nth_tick(30,function()
 if manual_wait then
  local player=game.get_player(1)
  if lib.globals.modal_data(player) then return end
  local qa=storage.planner.parity_qa
  local plan=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,qa.machineUiId)
  if not plan.lines[1].constraint or math.abs(plan.lines[1].constraint.count-3.5)>=.001 then
   remote.call('facmandu-toby-planner','open_plan',player.force.name,player.name,qa.machineUiId)
   lib.gui.open_dialog(player,{dialog='machine',modal_data={machine_id=OBJECT_INDEX[plan.lines[1].lineId].machine.id}})
   lib.gui.select_all(lib.globals.modal_data(player).capacity_amount)
   log('TOBY_NATIVE_MANUAL_MACHINE_READY')
   return
  end
  assert(plan.lines[1].machines<=3.501,'Maximum machine capacity was exceeded')
  manual_wait=false
  finish=true
  log('TOBY_NATIVE_DRAFT_MACHINE_MANUAL_SUBMIT_OK')
  return
 end
 if finish then
  finish=false
  local player=game.get_player(1)
  local qa=storage.planner.parity_qa
  remote.call('facmandu-toby-planner','open_plan',player.force.name,player.name,qa.planId)
  lib.context.set(player,OBJECT_INDEX[qa.blockId])
  lib.gui.run_refresh(player,'production')
  game.auto_save('toby-planning-parity-qualified')
  lib.gui.open_dialog(player,{dialog='supply',modal_data={floor_id=qa.blockId}})
  log('TOBY_PLANNING_UI_READY')
  return
 end
 if done or not storage.planner.parity_qa then return end
 local player=game.get_player(1)
 if not player or not player.connected or not lib.globals.player_table(player).translation_tables then return end
 if player.controller_type==defines.controllers.cutscene then return end
 done=true
 local qa=storage.planner.parity_qa
 local function call(operation,...) return remote.call('facmandu-toby-planner',operation,player.force.name,player.name,...) end
 local function open(id) call('open_plan',id) end
 local function dialog(kind,data) lib.gui.open_dialog(player,{dialog=kind,modal_data=data}) end
 local function close(action) lib.gui.close_dialog(player,action) end
 local function modal() return lib.globals.modal_data(player) end
 local function read(id) return call('read_plan',id) end
 open(qa.beltId)
 dialog('supply')
 GUI_HANDLERS.supply_pick.handler(player,{category='inputs',row=1})
 assert(lib.globals.ui_state(player).modal_dialog_type=='picker')
 assert(modal().supply_mode.selected_index==1,'Editing a maximum input changed its mode')
 assert(modal().amount_defined_by=='belts' and modal().belt_stack==2)
 modal().modal_elements.belt_amount_textfield.text='.25'
 close('submit')
 assert(lib.globals.ui_state(player).modal_dialog_type=='supply')
 assert(modal().draft.inputs[1].definition.count==.25 and modal().draft.inputs[1].mode=='maximum')
 close('submit')
 assert(read(qa.beltId).factory.inputs[1].definition.count==.25)
 -- An agent replacement must survive cancelling an older machine or beacon editor.
 open(qa.planId)
 local plan=read(qa.planId)
 local line=OBJECT_INDEX[plan.lines[1].lineId]
 dialog('machine',{machine_id=line.machine.id})
 plan=call('edit_line',plan.planId,plan.revision,line.id,{machine='assembling-machine-2',quality='uncommon'})
 close('cancel')
 assert(read(plan.planId).lines[1].quality=='uncommon','Cancel overwrote a newer machine edit')
 dialog('beacon',{line_id=line.id})
 plan=call('edit_line',plan.planId,plan.revision,line.id,{beacon={name='beacon',quality='normal',count=2,modules={}}})
 close('cancel')
 assert(read(plan.planId).lines[1].beacon.count==2,'Cancel overwrote a newer beacon edit')
 -- A stale picker must close without returning an old supply draft.
 dialog('supply')
 GUI_HANDLERS.supply_pick.handler(player,{category='inputs'})
 plan=call('set_products',plan.planId,plan.revision,{{name='iron-gear-wheel',type='item',perMinute=20}})
 close('cancel')
 assert(not lib.globals.ui_state(player).modal_dialog_type,'Stale picker reopened its draft')
 -- A force change can remove the selected factory altogether.
 dialog('supply')
 GUI_HANDLERS.supply_pick.handler(player,{category='inputs'})
 local old_force=player.force
 player.force=game.create_force('native-editor-parity-other')
 close('cancel')
 assert(not lib.globals.ui_state(player).modal_dialog_type)
 player.force=old_force
 game.merge_forces('native-editor-parity-other',old_force)
 open(qa.planId)
 qa.revision=read(qa.planId).revision
 log('TOBY_NATIVE_EDITOR_BELTS_AND_CONCURRENT_CANCEL_OK')
 local manual=call('create_plan',player.surface.name,'Manual draft machine QA',
  {{name='iron-plate',type='item',perMinute=60}},{{name='iron-plate',machine='stone-furnace'}})
 qa.machineUiId=manual.planId
 open(manual.planId)
 dialog('machine',{machine_id=OBJECT_INDEX[manual.lines[1].lineId].machine.id})
 lib.gui.select_all(modal().capacity_amount)
 manual_wait=true
 log('TOBY_NATIVE_MANUAL_MACHINE_READY')
end)
return true
