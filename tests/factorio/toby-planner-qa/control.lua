-- Native planner acceptance in an empty, isolated world. No items or research granted.
script.on_init(function() storage.done=false end)
script.on_nth_tick(30,function()
 if storage.done then return end
 local p=game.connected_players[1]
 if not p then return end
 storage.done=true
 local ok,result=pcall(function()
  local before=remote.call('fp-interface','export_current_factory',p.index)
  local preferences=remote.call('fp-interface','export_preferences',p.index)
  local count=p.get_main_inventory().get_item_count()
  local products={{name='iron-plate',type='item',perMinute=120}}
  local recipes={{name='iron-plate',machine='stone-furnace'}}
  local function solve(force,outputs,lines)
   return remote.call('facmandu-factory-planner','solve',force,p.name,p.surface.name,outputs or products,lines or recipes)
  end
  local plan=solve(p.force.name)
  assert(#plan.lines==1 and plan.lines[1].machine=='stone-furnace')
  assert(not plan.solverError and math.abs(plan.products[1].perMinute-120)<0.000001)
  local expected=2*prototypes.recipe['iron-plate'].energy/prototypes.entity['stone-furnace'].get_crafting_speed()
  assert(math.abs(plan.lines[1].machines-expected)<0.000001)
  local plate,ore=0,0
  for _,row in ipairs(plan.lines[1].products) do if row.name=='iron-plate' then plate=row.perMinute end end
  for _,row in ipairs(plan.lines[1].ingredients) do if row.name=='iron-ore' then ore=row.perMinute end end
  assert(math.abs(plate-120)<0.000001 and math.abs(ore-120)<0.000001)
  assert(not pcall(solve,'enemy'))
  assert(not pcall(solve,p.force.name,{{name='iron-plate',type='item',perMinute=-1}}))
  assert(not pcall(solve,p.force.name,products,{{name='iron-plate',machine='chemical-plant'}}))
  assert(not pcall(solve,p.force.name,products,{{name='iron-plate'},{name='iron-plate'}}))
  local after=remote.call('fp-interface','export_current_factory',p.index)
  assert((before==nil and after==nil) or (before and after and helpers.table_to_json(before)==helpers.table_to_json(after)))
  assert(helpers.table_to_json(preferences)==helpers.table_to_json(remote.call('fp-interface','export_preferences',p.index)))
  assert(p.get_main_inventory().get_item_count()==count)
  return {passed=true,plan=plan,expectedMachines=expected,selectionPreserved=true,preferencesPreserved=true,inventoryPreserved=true}
 end)
 local proof=ok and result or {passed=false,error=tostring(result)}
 log('TOBY_PLANNER_QA '..helpers.table_to_json(proof))
 helpers.write_file('toby-planner-qa.json',helpers.table_to_json(proof),false)
end)
