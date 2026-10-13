local bootstrap=require('events').scope('bootstrap')
bootstrap.on_init(function() storage.planner={} end)
bootstrap.on_configuration_changed(function() storage.planner=storage.planner or {} end)
require('planner.control')
require('planner.api')
local events=require('events').scope('toby')
local PREFIX='facmandu-toby-'
local drone=require('drone')
local references=require('references')
local function drone_status(player,refs)
 local state=drone.read(player.force.name,player.name)
 refs.drone_status.caption=state.available and ('Toby · '..state.display) or 'Waiting for your character'
 refs.drone_work.caption=state.activity and state.activity.message or 'Ready'
 refs.drone_details.caption=state.available and (state.mode..' · '..state.surface..' ['..math.floor(state.position.x)..', '..math.floor(state.position.y)..']\n'..(state.built or 0)..' ghosts built') or ''
 refs.drone_follow.enabled=state.available;refs.drone_stay.enabled=state.available;refs.drone_inventory.enabled=state.available
end
local function bounded_text(value,limit)
 if #value<=limit then return value end
 while limit>0 and value:byte(limit+1)>=128 and value:byte(limit+1)<=191 do limit=limit-1 end
 return value:sub(1,limit)
end
local function emit(player,operation,prompt,chat)
 storage.sequence=(storage.sequence or 0)+1
 log('[FACMANDU_UI] '..helpers.table_to_json({player=player.name,operation=operation,prompt=prompt,chat=chat,sequence=storage.sequence}))
end
local function button(player)
 if not player.gui.top[PREFIX..'open'] then
  player.gui.top.add{type='sprite-button',name=PREFIX..'open',sprite='toby-launcher',style='slot_button',tooltip={'shortcut-name.facmandu-toby-open'}}
 end
end
local function label(parent,caption,width,style)
 local element=parent.add{type='label',caption=caption,style=style or 'label'}
 element.style.single_line=false
 element.style.width=width
 return element
end
local function panel(player)
 local existing=player.gui.screen[PREFIX..'panel']
 if existing then return storage.gui[player.index] end
 local height=math.floor(math.max(460,math.min(780,player.display_resolution.height/player.display_scale-120)))
 local frame=player.gui.screen.add{type='frame',name=PREFIX..'panel',direction='vertical'}
 frame.style.width=480
 frame.location={x=16,y=64}
 local title=frame.add{type='flow',direction='horizontal'}
 label(title,'Toby',100,'frame_title').ignored_by_interaction=true
 local handle=title.add{type='empty-widget',style='draggable_space_header'}
 handle.style.horizontally_stretchable=true;handle.style.height=24
 handle.drag_target=frame
 title.add{type='sprite-button',name=PREFIX..'close',sprite='utility/close',style='frame_action_button',tooltip='Close · Your draft is kept'}
 local body=frame.add{type='frame',style='inside_shallow_frame',direction='vertical'}
 body.style.horizontally_stretchable=true
 local navigation=body.add{type='flow',direction='horizontal'}
 navigation.add{type='button',name=PREFIX..'planning',caption='Planning',style='toby_planner_button_frame_tool',tooltip='Open production planning · Works without AI'}
 local chats=navigation.add{type='drop-down',name=PREFIX..'chats',items={'New conversation'},selected_index=1}
 chats.style.horizontally_stretchable=true
 navigation.add{type='button',name=PREFIX..'new',caption='New chat',tooltip='Start a separate conversation; existing runs keep working'}
 local status=body.add{type='label',caption='Waiting for Facmandu'}
 status.style.width=432;status.style.single_line=false
 status.style.font_color={r=0.75,g=0.75,b=0.75}
 local tabs=body.add{type='tabbed-pane',name=PREFIX..'tabs'}
 tabs.style.horizontally_stretchable=true
 local refs={frame=frame,chats=chats,status=status,tabs=tabs}
 for _,entry in ipairs{{'conversation','Chat'},{'activity','Activity'},{'design','Design'}} do
  local tab=tabs.add{type='tab',caption=entry[2]}
  local content=tabs.add{type='scroll-pane',name=PREFIX..entry[1],direction='vertical',horizontal_scroll_policy='never'}
  content.style.width=432;content.style.height=height-240
  local rows=content.add{type='flow',direction='vertical'}
  rows.style.vertical_spacing=12;rows.style.width=410
  tabs.add_tab(tab,content)
  refs[entry[1]]=rows
  if entry[1]=='conversation' then refs.history=content end
 end
 local drone_tab=tabs.add{type='tab',caption='Drone'}
 local drone_content=tabs.add{type='flow',direction='vertical'}
 drone_content.style.width=432;drone_content.style.height=height-240
 refs.drone_status=label(drone_content,'',410,'heading_2_label')
 drone_content.add{type='sprite',sprite='entity/toby-drone'}.style.size=64
 refs.drone_work=label(drone_content,'Ready',410)
 refs.drone_details=label(drone_content,'',410)
 label(drone_content,'Nearby ghosts are built with your items.',410)
 refs.drone_inventory=drone_content.add{type='button',name=PREFIX..'drone-inventory',caption='Inventory'}
 local drone_actions=drone_content.add{type='flow',direction='horizontal'}
 refs.drone_follow=drone_actions.add{type='button',name=PREFIX..'drone-follow',caption='Follow me'}
 refs.drone_stay=drone_actions.add{type='button',name=PREFIX..'drone-stay',caption='Stay here'}

 tabs.add_tab(drone_tab,drone_content)
 tabs.selected_tab_index=storage.tabs[player.index] or 1
 drone_status(player,refs)
 local composer=frame.add{type='textfield',name=PREFIX..'message',text=storage.drafts[player.index] or '',tooltip='Enter: send or steer · Ctrl+Shift+Enter: open blueprint'}
 composer.style.width=456;composer.style.height=36
 local actions=frame.add{type='flow',direction='horizontal'}
 actions.style.width=456
 local context=actions.add{type='label',caption=player.surface.name}
 context.style.font_color={r=0.75,g=0.75,b=0.75}
 actions.add{type='empty-widget'}.style.horizontally_stretchable=true
 local stop=actions.add{type='button',name=PREFIX..'stop',caption='Stop',visible=false}
 local send=actions.add{type='button',name=PREFIX..'send',caption='Send',style='confirm_button',tooltip='Send a message to Toby · Enter'}
 refs.message=composer;refs.stop=stop;refs.send=send;refs.context=context
 storage.gui[player.index]=refs
 player.opened=frame
 composer.focus()
 return refs
end
local function selected(player)
 local state=storage.players[player.index]
 local refs=storage.gui[player.index]
 local index=refs and refs.frame.valid and refs.chats.selected_index
 return state and state.chats and state.chats[index or 0] and state.chats[index].id
end
local function update(player_index,state)
 local player=game.get_player(player_index)
 if not player then error('Player not found',0) end
 if type(state)~='table' or type(state.status)~='string' or #state.status>500 or type(state.answer)~='string' or #state.answer>6000 then error('Invalid panel update',0) end
 if type(state.chats)~='table' or #state.chats>8 then error('Expected up to eight chats',0) end
 if state.blueprint and (type(state.blueprint)~='string' or #state.blueprint>65536 or not state.blueprint:match('^0[%w+/=]+$')) then error('Invalid blueprint',0) end
 if state.designStage and (type(state.designStage)~='string' or #state.designStage>40) then error('Invalid design stage',0) end
 if state.designWarnings then
  if type(state.designWarnings)~='table' or #state.designWarnings>8 then error('Invalid design warnings',0) end
  for _,warning in ipairs(state.designWarnings) do if type(warning)~='string' or #warning>400 then error('Invalid design warning',0) end end
 end
 if state.design and (type(state.design)~='string' or #state.design>200) then error('Invalid design title',0) end
 if state.materials and (type(state.materials)~='table' or #state.materials>32) then error('Invalid construction materials',0) end
 for _,item in ipairs(state.materials or {}) do
  if type(item.name)~='string' or #item.name>100 or type(item.count)~='number' or item.count<=0 or item.count>1000000 or item.count~=math.floor(item.count) then error('Invalid construction material',0) end
 end
 for _,field in ipairs{'messages','activity'} do
  local rows=state[field] or {}
  if type(rows)~='table' or #rows>16 then error('Invalid '..field,0) end
  local bytes=0
  for _,row in ipairs(rows) do
   if type(row)~='table' or type(row.text)~='string' or #row.text>6000 then error('Invalid '..field..' entry',0) end
   if field=='messages' and row.role~='user' and row.role~='assistant' then error('Invalid message author',0) end
   bytes=bytes+#row.text
  end
  if bytes>12000 then error('Panel content too large',0) end
 end
 local items={}
 for _,chat in ipairs(state.chats) do
  if type(chat.id)~='string' or #chat.id>100 or type(chat.title)~='string' or #chat.title>200 then error('Invalid chat',0) end
  items[#items+1]=chat.title
 end
 if state.drone then drone.activity(player,state.drone) end
 storage.players[player.index]=state
 button(player)
 local refs=storage.gui[player.index]
 if not refs or not refs.frame.valid then return end
 refs.status.caption=state.status
 refs.context.caption=player.surface.name
 refs.stop.visible=state.running==true
 refs.send.caption=state.running and 'Steer' or 'Send'
 refs.send.tooltip=state.running and 'Steer the current run · Enter' or 'Send a message to Toby · Enter'
 refs.chats.items=#items>0 and items or {'New conversation'}
 for i,chat in ipairs(state.chats) do if chat.id==state.current then refs.chats.selected_index=i;break end end
 -- Progress updates never recreate a transcript the player is reading.
 -- Factorio 2.1 does not lay out newly populated inactive tabs; refresh on selection.
 local message_signature=helpers.table_to_json(state.messages or {})..state.answer
 if refs.tabs.selected_tab_index==1 and (refs.message_signature~=message_signature or refs.conversation_chat~=state.current) then
  if not refs.message_signature or refs.conversation_chat~=state.current then refs.conversation.clear() end
  local messages=state.messages or (#state.answer>0 and {{role='assistant',text=state.answer}} or {})
  if refs.conversation.children[1] and refs.conversation.children[1].type~='flow' then refs.conversation.clear() end
  for i,message in ipairs(messages) do
   local row=refs.conversation.children[i]
   if not row then
    row=refs.conversation.add{type='flow',direction='vertical'}
    row.style.vertical_spacing=4
    label(row,'',410,'heading_2_label');label(row,'',410)
   end
   local author=row.children[1]
   author.caption=message.role=='user' and (player.name~='' and player.name or 'You') or 'Toby'
   author.style.font_color=message.role=='user' and {r=0.75,g=0.75,b=0.75} or {r=1,g=0.8,b=0.45}
   if row.children[2].caption~=message.text then
    row.children[2].caption=message.text
    if row.children[3] then row.children[3].destroy() end
    references.text(row,message.text)
   end
  end
  for i=#refs.conversation.children,#messages+1,-1 do refs.conversation.children[i].destroy() end
  if #messages==0 then label(refs.conversation,'What shall we build?',410,'heading_2_label') end
  if not refs.message_signature or refs.conversation_chat~=state.current then refs.history.scroll_to_bottom() end
  refs.message_signature=message_signature;refs.conversation_chat=state.current
 end
 local activity_signature=helpers.table_to_json{activity=state.activity,current=state.current,running=state.running,status=#(state.activity or {})==0 and state.status or nil}
 if refs.tabs.selected_tab_index==2 and refs.activity_signature~=activity_signature then
  if refs.activity.children[1] and refs.activity.children[1].type~='frame' then refs.activity.clear() end
  for i,entry in ipairs(state.activity or {}) do
   local card=refs.activity.children[i]
   if not card then card=refs.activity.add{type='frame',style='inside_shallow_frame',direction='vertical'};card.style.width=410;label(card,'',390) end
   if card.children[1].caption~=entry.text then
    card.children[1].caption=entry.text
    if card.children[2] then card.children[2].destroy() end
    references.text(card,entry.text)
   end
  end
  for i=#refs.activity.children,#(state.activity or {})+1,-1 do refs.activity.children[i].destroy() end
  if #(state.activity or {})==0 then label(refs.activity,state.running and state.status or 'No tools used in this turn.',410) end
  refs.activity_signature=activity_signature
 end
 local design_signature=helpers.table_to_json{blueprint=state.blueprint,design=state.design,stage=state.designStage,warnings=state.designWarnings,materials=state.materials,current=state.current,running=state.running}
 if refs.tabs.selected_tab_index==3 and refs.design_signature~=design_signature then
  refs.design.clear()
  if state.blueprint then
   label(refs.design,state.designStage or 'Design',410,'heading_2_label')
   label(refs.design,state.design or 'Latest blueprint',410)
   for _,warning in ipairs(state.designWarnings or {}) do
    local row=label(refs.design,warning,410);row.style.font_color={r=1,g=0.75,b=0.3}
   end
   local actions=refs.design.add{type='flow',direction='horizontal'}
   actions.add{type='button',name=PREFIX..'inspect-blueprint',caption='Inspect blueprint',tooltip='Open Factorio’s blueprint editor · Ctrl+Shift+Enter'}
   actions.add{type='button',name=PREFIX..'blueprint',caption='Take blueprint',style='confirm_button',tooltip='Put the design in your cursor to place ghosts.'}
   if #(state.materials or {})>0 then
    label(refs.design,'Materials · Alt-click to inspect',410,'heading_2_label')
    local materials=refs.design.add{type='table',column_count=8}
    for _,item in ipairs(state.materials) do references.add(materials,'item',item.name,item.count) end
   end
  else label(refs.design,state.running and 'Design in progress. Validated drafts appear here as they are created.' or 'No design created in this chat.',410) end
  refs.design_signature=design_signature
 end
 drone_status(player,refs)
end
local function open(player)
 local refs=panel(player)
 refs.frame.visible=true
 player.opened=refs.frame
 local state=storage.players[player.index]
 if state then local old=storage.players[player.index];storage.players[player.index]=nil;update(player.index,old) end
 emit(player,'refresh')
end
events.on_init(function()
 storage.players={};storage.drafts={};storage.tabs={};storage.gui={};storage.sequence=0
 drone.init()
 for _,player in pairs(game.players) do button(player) end
end)
events.on_configuration_changed(function()
 drone.init()
 storage.players=storage.players or {};storage.drafts=storage.drafts or {};storage.tabs=storage.tabs or {};storage.gui=storage.gui or {}
 for _,player in pairs(game.players) do
  button(player)
  local old=player.gui.screen[PREFIX..'panel']
  if old then
   old.destroy();open(player)
  end
 end
end)
events.on_event(defines.events.on_player_created,function(event) button(game.get_player(event.player_index)) end)
events.on_event(defines.events.on_player_joined_game,function(event) button(game.get_player(event.player_index)) end)
events.on_event('facmandu-toby-toggle',function(event)
 local player=game.get_player(event.player_index)
 local frame=player.gui.screen[PREFIX..'panel']
 if frame and frame.visible then frame.destroy() else open(player) end
end)
events.on_event(defines.events.on_lua_shortcut,function(event)
 if event.prototype_name=='facmandu-toby-open' then
  local player=game.get_player(event.player_index)
  local frame=player.gui.screen[PREFIX..'panel']
  if frame and frame.visible then frame.destroy() else open(player) end
 end
end)
events.on_event('facmandu-toby-claim-drone',function(event)
 local player=game.get_player(event.player_index)
 local ok,message=pcall(drone.bind,player,player.selected)
 if not ok then player.print(message);return end
 open(player);storage.gui[player.index].tabs.selected_tab_index=4;storage.tabs[player.index]=4
end)
events.on_event('facmandu-toby-open-drone',function(event)
 local player=game.get_player(event.player_index)
 open(player);storage.gui[player.index].tabs.selected_tab_index=4;storage.tabs[player.index]=4
end)
local function take_blueprint(player,inspect)
 local state=storage.players[player.index]
 if not state or not state.blueprint then player.print('This conversation has no blueprint yet.');return end
 if not player.clear_cursor() then player.print('Clear some inventory space before taking the blueprint.');return end
 local ok,result=pcall(player.cursor_stack.import_stack,state.blueprint)
 if not ok or result~=0 then player.print('Factorio could not import this blueprint.');return end
 local frame=player.gui.screen[PREFIX..'panel']
 if frame then frame.destroy() end
 if inspect then player.opened=player.cursor_stack end
end
events.on_event('facmandu-toby-design',function(event) take_blueprint(game.get_player(event.player_index),true) end)
local function send(player)
 local refs=storage.gui[player.index]
 if not refs or not refs.frame.valid then return end
 local text=refs.message.text:match('^%s*(.-)%s*$')
 if #text>0 and #text<=6000 then emit(player,'send',text,selected(player));refs.message.text='';storage.drafts[player.index]='' end
end
events.on_event(defines.events.on_gui_confirmed,function(event)
 if event.element.valid and event.element.name==PREFIX..'message' then
  local player=game.get_player(event.player_index)
  if event.control and event.shift then take_blueprint(player,true) else send(player) end
 end
end)
events.on_event(defines.events.on_gui_click,function(event)
 if event.element and event.element.valid and event.element.name==PREFIX..'planning' then
  local player=game.get_player(event.player_index)
  if storage.gui[player.index] and storage.gui[player.index].frame.valid then storage.gui[player.index].frame.visible=false end
  main_dialog.toggle(player)
  return
 end
 local element=event.element
 if not element.valid then return end
 local player=game.get_player(event.player_index)
 if references.click(player,element) then return end
 local name=element.name
 local refs=storage.gui[player.index]
 if name==PREFIX..'open' then open(player)
 elseif name==PREFIX..'close' then refs.frame.destroy()
 elseif name==PREFIX..'send' then
  send(player)
 elseif name==PREFIX..'new' then emit(player,'new')
 elseif name==PREFIX..'stop' then emit(player,'stop',nil,selected(player))
 elseif name==PREFIX..'drone-follow' or name==PREFIX..'drone-stay' then
  local state=drone.read(player.force.name,player.name)
  local ok,message=pcall(drone.command,player.force.name,player.name,name==PREFIX..'drone-follow' and 'follow' or 'stay',state)
  if not ok then player.print(message) end
  drone_status(player,refs)
 elseif name==PREFIX..'drone-inventory' then
  local state=storage.drones[player.index]
  if state and state.entity.valid then refs.frame.destroy();player.opened=state.entity end
 elseif name==PREFIX..'blueprint' or name==PREFIX..'inspect-blueprint' then
  take_blueprint(player,name==PREFIX..'inspect-blueprint')
 end
end)
events.on_event(defines.events.on_built_entity,drone.built)
events.on_nth_tick(5,function(event)
 if event.tick%10==0 then drone.tick() end
 drone.animate()
 if event.tick%60~=0 then return end
 for index,refs in pairs(storage.gui or {}) do
  if refs.frame.valid then local player=game.get_player(index);if player then drone_status(player,refs) end end
 end
end)
events.on_event(defines.events.on_gui_text_changed,function(event)
 if event.element.valid and event.element.name==PREFIX..'message' then storage.drafts[event.player_index]=bounded_text(event.element.text,6000) end
end)
events.on_event(defines.events.on_gui_selection_state_changed,function(event)
 if event.element.valid and event.element.name==PREFIX..'chats' then
  local player=game.get_player(event.player_index)
  emit(player,'select',nil,selected(player))
 end
end)
events.on_event(defines.events.on_gui_selected_tab_changed,function(event)
 if event.element.valid and event.element.name==PREFIX..'tabs' then
  storage.tabs[event.player_index]=event.element.selected_tab_index
  local state=storage.players[event.player_index]
  if state then update(event.player_index,state) end
 end
end)
remote.add_interface('facmandu-assistant',{update_player=update,open_player=function(index) local player=game.get_player(index);if not player then error('Player not found',0) end open(player);return true end})
events.on_event(defines.events.on_gui_closed,function(event)
 if event.element and event.element.valid and event.element.name==PREFIX..'panel' then event.element.destroy() end
end)
