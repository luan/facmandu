-- Optional manual QA on the qualified full-pack save, using the upstream test hook.
local events=require('__facmandu-assistant__/events').scope('native-planner-shortcuts-qa')
local plan_id,done
local function call(player,operation,...) return remote.call('facmandu-toby-planner',operation,player.force.name,player.name,...) end
events.on_nth_tick(30,function()
 if done then return end
 local player=game.get_player(1)
 if not player or not player.connected or not lib.globals.player_table(player).translation_tables then return end
 if not plan_id then
  for _,plan in ipairs(call(player,'list_plans').plans) do
   if plan.name=='Manual capacity QA' then plan_id=plan.planId end
  end
  assert(plan_id,'Load the qualified full-pack save')
  call(player,'open_plan',plan_id)
  lib.gui.open_dialog(player,{dialog='supply'})
  GUI_HANDLERS.supply_pick.handler(player,{category='maximize'})
  lib.globals.modal_elements(player).search_textfield.text='iron-plate'
  assert(GLOBAL_HANDLERS.confirm_picker_search(player),'Existing products must be selectable as maximization goals')
  assert(lib.globals.modal_data(player).item_proto.name=='iron-plate')
  lib.gui.close_dialog(player,'submit')
  assert(lib.globals.modal_data(player).draft.maximize_product.name=='iron-plate')
  lib.gui.close_dialog(player,'cancel')
  log('TOBY_NATIVE_EXISTING_OUTPUT_PICKER_OK')
  log('TOBY_NATIVE_INPUT_SHORTCUT_READY')
  return
 end
 local plan=call(player,'read_plan',plan_id)
 local input=plan.factory.inputs[1]
 if input and input.name=='iron-ore' and math.abs(input.amount*60-80)<.001 and not lib.globals.modal_data(player) then
  local ore,plate
  for _,row in ipairs(plan.ingredients) do if row.name=='iron-ore' then ore=row.perMinute end end
  for _,row in ipairs(plan.products) do if row.name=='iron-plate' then plate=row.perMinute end end
  assert(plan.status=='solved' and math.abs(ore-80)<.001 and math.abs(plate-40)<.001)
  assert(plan.lines[1].constraint.count==3.5)
  done=true
  log('TOBY_NATIVE_INPUT_SHORTCUT_AND_BALANCE_OK')
  game.auto_save('toby-planning-full-input-qualified')
 end
end)
return true
