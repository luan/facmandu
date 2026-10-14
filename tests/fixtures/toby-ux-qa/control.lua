-- Runs only against a disposable copy of the QA world.
local function pending() storage.pending=true end
script.on_init(pending)
script.on_configuration_changed(pending)
local function find(element,name)
 if element.name==name then return element end
 for _,child in ipairs(element.children) do local found=find(child,name);if found then return found end end
end
script.on_nth_tick(10,function()
 if not storage.pending then return end
 storage.pending=false
 local player=assert(game.get_player(1))
 local state={force=player.force.name,status='Ready',answer='',current='ux',chats={{id='ux',title='Typing QA'}}}
 remote.call('facmandu-assistant','update_player',player.index,state)
 remote.call('facmandu-assistant','open_player',player.index)
 local chat=assert(player.gui.screen['facmandu-toby-panel'])
 assert(not find(chat,'facmandu-toby-planning'))
 local input=assert(find(chat,'facmandu-toby-message'))
 input.text='i need you to design a glass line'
 state.status='Inspecting the factory';state.running=true
 remote.call('facmandu-assistant','update_player',player.index,state)
 assert(input.valid and input.text=='i need you to design a glass line')
 remote.call('facmandu-toby-planner','open',player.index)
 local planner=assert(player.gui.screen.toby_planner_frame_main_dialog)
 local function separate(element)
  assert(not(element.tags and element.tags.on_gui_click=='open_toby_agent'))
  for _,child in ipairs(element.children) do separate(child) end
 end
 separate(planner)
 local buttons={}
 local function launchers(element)
  if element.name=='toby_planner_button_toggle_interface' then buttons.planner=true end
  if element.name=='facmandu-toby-open' then buttons.chat=true end
  for _,child in ipairs(element.children) do launchers(child) end
 end
 launchers(player.gui.top)
 assert(buttons.chat and buttons.planner,'Separate launchers must be present')
 helpers.write_file('toby-ux-qa.json',helpers.table_to_json({passed=true,version=script.active_mods['facmandu-assistant'],draftPreserved=true,separateLaunchers=true,separateWindows=true}),false)
 log('TOBY_UX_QA_PASS')
end)
