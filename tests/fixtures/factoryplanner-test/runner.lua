-- Disposable copied full-pack world only. Research changes never belong on a live save.
-- Exercise production APIs and real dialogs through the upstream native test hook.
if script.mod_name~='facmandu-assistant' then return function() end end
local Line=require('__facmandu-assistant__/planner/backend/data/Line')
local events=require('__facmandu-assistant__/events').scope('native-performance-qa')
local function measure(name,fn)
 local timer=helpers.create_profiler()
 local result=fn()
 timer.stop()
 log({'','TOBY_NATIVE_PERF ',name,' ',timer})
 return result
end
return function()
 local empty_filter_run=false
 local search=modal_dialog.run_search
 modal_dialog.run_search=function(player)
  local kind=lib.globals.ui_state(player).modal_dialog_type
  if kind=='recipe' or kind=='picker' then
   local result=measure(kind..'_search',function() return search(player) end)
   if kind=='recipe' then empty_filter_run=lib.globals.modal_data(player).modal_elements.search_textfield.text=='no_matching_recipe_xyz' end
   return result
  end
  return search(player)
 end
 local done=false
 local phase='prepare'
 local player,factory,small,line
 events.on_nth_tick(30,function()
  if done then return end
  if phase=='prepare' then
   player=game.get_player(1);assert(player)
   player.force.research_all_technologies()
   local result=remote.call('facmandu-toby-planner','create_plan',player.force.name,player.name,player.surface.name,
    'Native performance QA',{{name='iron-plate',type='item',perMinute=60}},{{name='iron-plate',machine='stone-furnace'}})
   factory=OBJECT_INDEX[result.planId]
   line=factory.top_floor.first
   local candidates={}
   for name,native in pairs(player.force.recipes) do
    local proto=prototyper.util.find('recipes',name)
    if native.enabled and proto and proto.name~='iron-plate' then candidates[#candidates+1]=proto end
   end
   table.sort(candidates,function(a,b) return a.name<b.name end)
   local count=1
   local next_size=50
   for _,proto in ipairs(candidates) do
    local row=Line.init(proto);row.parent=factory.top_floor
    row.recipe:apply_temperature_defaults(player)
    if row:change_machine_to_default(player) then
     local compatible=row:get_surface_compatibility()
     if compatible.recipe and compatible.machine then
      factory.top_floor:insert(row);count=count+1
      if count==next_size then
       measure('solve_'..count,function() factory:clear_solver_cache();solver.update(player,factory) end)
       assert(not factory.top_floor.solver_error,'Large plan failed at '..count)
       assert(math.abs(factory:as_list()[1].amount-1)<.001)
       measure('warm_solve_'..count,function() solver.update(player,factory) end)
       if next_size==200 then break end
       next_size=next_size==50 and 100 or 200
      end
     end
    end
   end
   assert(count==200,'Full pack must provide 200 compatible recipes')
   local revision=factory.revision
   for i=1,5 do
    local updated=measure('edit_200_'..i,function()
     return remote.call('facmandu-toby-planner','edit_line',player.force.name,player.name,factory.id,revision,
      factory.top_floor:find_last().id,{quality=i%2==1 and 'uncommon' or 'normal'})
    end)
    revision=updated.revision
    assert(updated.status=='solved' and math.abs(factory:as_list()[1].amount-1)<.001)
   end
   for i=1,5 do
    local updated=measure('input_edit_200_'..i,function()
     return remote.call('facmandu-toby-planner','set_inputs',player.force.name,player.name,factory.id,revision,
      {{name='iron-ore',type='item',perMinute=300+i,mode='maximum'}},nil)
    end)
    revision=updated.revision
    assert(updated.status=='solved' and math.abs(factory:as_list()[1].amount-1)<.001)
   end
   log('TOBY_NATIVE_LARGE_PLAN_OK rows='..count)
   small=remote.call('facmandu-toby-planner','create_plan',player.force.name,player.name,player.surface.name,
    'Manual capacity QA',{{name='iron-plate',type='item',perMinute=600}},{{name='iron-plate',machine='stone-furnace',constraint={count=2,mode='maximum'}}},nil,{name='iron-plate',type='item'})
   line=OBJECT_INDEX[small.lines[1].lineId]
   phase='wait_ui'
  elseif phase=='wait_ui' then
   if not player.connected or not lib.globals.player_table(player).translation_tables then return end
   measure('open_plan_200',function() remote.call('facmandu-toby-planner','open_plan',player.force.name,player.name,factory.id) end)
   remote.call('facmandu-toby-planner','open_plan',player.force.name,player.name,small.planId)
   measure('machine_dialog_open',function() lib.gui.open_dialog(player,{dialog='machine',modal_data={machine_id=line.machine.id}}) end)
   lib.gui.select_all(lib.globals.modal_data(player).capacity_amount)
   log('TOBY_MANUAL_CAPACITY_READY expected=3.5')
   phase='capacity'
  elseif phase=='capacity' then
   if lib.globals.modal_data(player) then return end
   assert(line.machine_constraint and line.machine_constraint.count==3.5,'Enter 3.5 and submit through the native dialog')
   local current=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,small.planId)
   assert(current.status=='solved' and math.abs(current.lines[1].machines-3.5)<.001)
   log('TOBY_MANUAL_CAPACITY_SUBMIT_OK')
   local proto=prototyper.util.find('items','iron-plate','item')
   for i=1,5 do
    measure('recipe_selector_open_'..i,function() lib.gui.open_dialog(player,{dialog='recipe',modal_data={production_type='produce',category_id=proto.category_id,product_id=proto.id}}) end)
    assert(lib.globals.modal_data(player),'Recipe selector must have multiple choices on the full pack')
    if i<5 then lib.gui.close_dialog(player,'cancel') end
   end
   log('TOBY_NATIVE_RECIPE_SELECTOR_READY')
   phase='search'
  elseif phase=='search' then
   local modal=lib.globals.modal_data(player)
   if modal and empty_filter_run then
    assert(modal.modal_elements.warning_label.visible)
    assert(modal.modal_elements.content_frame.style.maximal_height<=130,'Empty selector retained hidden-group space')
    log('TOBY_NATIVE_SELECTOR_EMPTY_LAYOUT_OK')
    empty_filter_run=false
   end
   if not modal then
    for i=1,5 do
     measure('item_picker_open_'..i,function() lib.gui.open_dialog(player,{dialog='picker',modal_data={item_category='product'}}) end)
     local groups=lib.globals.modal_data(player).modal_elements.groups
     local built=0;for _,group in ipairs(groups) do if group.scroll_pane then built=built+1 end end
     assert(built==1,'Item picker constructed unvisited groups')
     if i<5 then lib.gui.close_dialog(player,'cancel') end
    end
    log('TOBY_NATIVE_ITEM_PICKER_READY');phase='picker'
   end
  elseif phase=='picker' then
   local modal=lib.globals.modal_data(player)
   if modal and modal.modal_elements.search_textfield.text=='iron plate' then
    local selected=modal.modal_elements.groups[modal.selected_group_id]
    if selected.visible_rows==1 then
     assert(modal.modal_elements.filter_frame.style.natural_height==64)
     log('TOBY_NATIVE_ITEM_PICKER_FILTER_LAYOUT_OK');phase='picker_done'
    end
   end
  elseif phase=='picker_done' then
   if not lib.globals.modal_data(player) then done=true;log('TOBY_NATIVE_DIALOGS_DONE');events.on_nth_tick(30,nil) end
  end
 end)
end
