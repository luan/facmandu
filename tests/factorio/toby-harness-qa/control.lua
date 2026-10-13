local references=require('__facmandu-assistant__/references')
local visuals=require('__facmandu-assistant__/drone-visuals')
-- Native UI and sprite fixture: its own empty world, never a player's save.
script.on_event(defines.events.on_player_created,function(event)
 local p=game.get_player(event.player_index)
 if not p.character then p.create_character() end
 p.surface.always_day=true
 p.surface.request_to_generate_chunks({0,0},1);p.surface.force_generate_chunk_requests()
 p.teleport({0,0})
 remote.call('facmandu-assistant','open_player',p.index)
 local inv=game.create_inventory(1);inv[1].set_stack{name='blueprint'}
 inv[1].set_blueprint_entities{{entity_number=1,name='chemical-plant',recipe='plastic-bar',position={0,0}}}
 storage.blueprint=inv[1].export_stack();inv.destroy()
 storage.player=p.index
end)
script.on_nth_tick(60,function()
 if game.tick<60 or not storage.player or storage.done then return end
 local ok,err=pcall(function()
  local p=game.get_player(storage.player)
  storage.entity=assert(p.surface.find_entities_filtered{name='toby-drone',force=p.force}[1])
  local api='facmandu-assistant'
  local state={status='Inspecting plastic production · 3 factory queries complete',answer='Designing [item=plastic-bar] from [fluid=petroleum-gas].',running=true,current='qa',chats={{id='qa',title='More plastic'}},messages={{role='user',text='I need more plastic'},{role='assistant',text='Designing [item=plastic-bar] from [fluid=petroleum-gas].'}},activity={{text='Factory inspection\nFound 6 chemical plants.'}},blueprint=storage.blueprint,design='Plastic module',designStage='Working draft',designWarnings={'Supply connection not checked yet.'},materials={{name='chemical-plant',count=8}},drone={phase='thinking',message='Designing the plastic module.'}}
  remote.call(api,'update_player',p.index,state)
  local frame=p.gui.screen['facmandu-toby-panel'];assert(frame)
  local body=frame.children[2];local tabs=body['facmandu-toby-tabs']
  assert(#tabs.tabs==4)
  local chat=tabs['facmandu-toby-conversation'].children[1]
  assert(#chat.children==2 and #chat.children[2].children==3)
  local icons=chat.children[2].children[3];assert(#icons.children==2)
  assert(icons.children[1].sprite=='item/plastic-bar' and icons.children[2].sprite=='fluid/petroleum-gas')
  local design=tabs['facmandu-toby-design'].children[1]
  assert(design.children[1].caption=='Working draft')
  assert(design.children[3].caption=='Supply connection not checked yet.')
  assert(design.children[6].children[1].number==8)
  tabs.selected_tab_index=2
  local old=design.children[1]
  remote.call(api,'update_player',p.index,state)
  assert(old.valid and tabs.selected_tab_index==2,'Progress recreated a tab')
  local d={entity=storage.entity,activity=state.drone}
  visuals.update(p,d)
  assert(d.visual.valid and d.shadow.valid and d.display=='thinking')
  d.entity.torso_orientation=0.5;visuals.update(p,d)
  assert(d.visual.animation_offset>=64 and d.visual.animation_offset<72,helpers.table_to_json({orientation=d.entity.torso_orientation,offset=d.visual.animation_offset}))
  d.activity={phase='error',message=''};visuals.update(p,d);assert(d.visual.animation=='toby-screen-error')
  visuals.clear(d);assert(not d.visual and not d.shadow)
  assert(references.click(p,icons.children[1]))
  helpers.write_file('toby-harness-qa.json',helpers.table_to_json({passed=true,version=script.active_mods['facmandu-assistant'],tabs=4,references=2,preservedTabs=true,screenStates=true}),false)
  log('TOBY_HARNESS_QA_PASS')
 end)
 if not ok then helpers.write_file('toby-harness-qa.json',helpers.table_to_json({error=tostring(err)}),false);log('TOBY_HARNESS_QA_FAIL '..tostring(err)) end
 storage.done=true
end)
