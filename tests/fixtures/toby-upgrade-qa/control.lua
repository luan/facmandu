-- Disposable copied save only. Seed with real Toby 0.0.1, then replace
-- only Toby with the current archive and load the resulting pre-planner save.
local checked=false
script.on_nth_tick(5,function()
 if checked then return end
 checked=true
 local player=game.get_player(1)
 assert(player,'Upgrade QA requires a copied save containing a player')
 if not storage.seeded then
  assert(script.active_mods['facmandu-assistant']=='0.0.1','Seed the save with the real pre-planner mod')
  local inventory=game.create_inventory(1)
  inventory[1].set_stack('blueprint')
  inventory[1].set_blueprint_entities{{entity_number=1,name='transport-belt',position={x=0,y=0}}}
  storage.blueprint=inventory[1].export_stack();inventory.destroy()
  storage.items=player.get_main_inventory() and player.get_main_inventory().get_contents()
  remote.call('facmandu-assistant','update_player',player.index,{status='Ready',answer='Legacy answer',
   current='legacy-chat',chats={{id='legacy-chat',title='Legacy conversation'}},
   messages={{role='assistant',text='Legacy answer'}},blueprint=storage.blueprint})
  remote.call('facmandu-assistant','open_player',player.index)
  storage.seeded=true
  log('TOBY_PRE_PLANNER_SAVE_SEEDED')
  if game.is_multiplayer() then game.server_save('toby-pre-planner') end
  return
 end
 assert(script.active_mods['facmandu-assistant']~='0.0.1','Replace Toby before testing the upgrade')
 remote.call('facmandu-assistant','open_player',player.index)
 local panel=player.gui.screen['facmandu-toby-panel']
 assert(panel and panel.valid)
 assert(player.gui.top['facmandu-toby-open'].type=='sprite-button','Upgrade retained the old text launcher')
 local function contains(element,text)
  if element.type=='label' and element.caption==text then return true end
  for _,child in pairs(element.children) do if contains(child,text) then return true end end
  return false
 end
 assert(contains(panel,'Legacy conversation') and contains(panel,'Legacy answer'),'Legacy conversation was lost')
 local book=remote.call('facmandu-assistant','export_book',player.force.name,player.name)
 local decoded=helpers.json_to_table(helpers.decode_string(book:sub(2)))
 assert(decoded.blueprint_book.blueprints[1].blueprint_book.blueprints[1].blueprint.entities[1].name=='transport-belt')
 if storage.items then assert(helpers.table_to_json(player.get_main_inventory().get_contents())==helpers.table_to_json(storage.items),'Upgrade changed player inventory') end
 local plans=remote.call('facmandu-toby-planner','list_plans',player.force.name,player.name)
 if not storage.planId then
  assert(#plans.plans==0,'A pre-planner save unexpectedly contains native plans')
  local created=remote.call('facmandu-toby-planner','create_plan',player.force.name,player.name,player.surface.name,
   'Upgraded plan',{{name='iron-plate',type='item',perMinute=60}},{{name='iron-plate',machine='stone-furnace'}})
  assert(created.status=='solved' and math.abs(created.products[1].perMinute-60)<.001)
  storage.planId=created.planId
  log('TOBY_PRE_PLANNER_UPGRADE_OK')
  if game.is_multiplayer() then game.server_save('toby-upgraded') end
 else
  local plan=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,storage.planId)
  assert(plan.status=='solved' and math.abs(plan.products[1].perMinute-60)<.001)
  log('TOBY_UPGRADED_SAVE_RELOAD_OK')
 end
end)
