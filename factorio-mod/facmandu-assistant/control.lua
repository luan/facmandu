local PREFIX='facmandu-toby-'
local drone=require('drone')
local function drone_status(player,refs)
 local state=drone.read(player.force.name,player.name)
 refs.drone_status.caption=state.available and ('Toby · '..state.mode..' · '..state.surface..' · '..state.robots..' robots') or 'Craft and place a Toby drone to assign it to you.'
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
  player.gui.top.add{type='button',name=PREFIX..'open',caption='Toby',tooltip='Open Toby · Ctrl+Shift+T · Development build'}
 end
end
local function label(parent,caption,width,style)
 local element=parent.add{type='label',caption=caption,style=style or 'label'}
 element.style.single_line=false
 element.style.maximal_width=width
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
 local chats=navigation.add{type='drop-down',name=PREFIX..'chats',items={'New conversation'},selected_index=1}
 chats.style.horizontally_stretchable=true
 local new=navigation.add{type='button',name=PREFIX..'new',caption='+',tooltip='New conversation'}
 new.style.minimal_width=32;new.style.maximal_width=32
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
  rows.style.vertical_spacing=12
  tabs.add_tab(tab,content)
  refs[entry[1]]=rows
  if entry[1]=='conversation' then refs.history=content end
 end
 local drone_tab=tabs.add{type='tab',caption='Drone'}
 local drone_content=tabs.add{type='flow',direction='vertical'}
 drone_content.style.width=432;drone_content.style.height=height-240
 refs.drone_status=label(drone_content,'',410,'heading_2_label')
 label(drone_content,'Equip Toby with a personal roboport, power and batteries. Load construction robots and materials into its inventory. Native robots build your nearby ghosts.',410)
 refs.drone_inventory=drone_content.add{type='button',name=PREFIX..'drone-inventory',caption='Equipment and inventory'}
 local drone_actions=drone_content.add{type='flow',direction='horizontal'}
 refs.drone_follow=drone_actions.add{type='button',name=PREFIX..'drone-follow',caption='Follow me'}
 refs.drone_stay=drone_actions.add{type='button',name=PREFIX..'drone-stay',caption='Stay here'}
 label(drone_content,'To assign an unowned drone, point at it in the game view and press Ctrl+Shift+Y.',410)
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
 local previous=storage.players[player.index]
 storage.players[player.index]=state
 button(player)
 local refs=storage.gui[player.index]
 if not refs or not refs.frame.valid then return end
 refs.status.caption=bounded_text(state.status,140)
 refs.context.caption=player.surface.name
 refs.stop.visible=state.running==true
 refs.send.caption=state.running and 'Steer' or 'Send'
 refs.send.tooltip=state.running and 'Steer the current run · Enter' or 'Send a message to Toby · Enter'
 refs.chats.items=#items>0 and items or {'New conversation'}
 for i,chat in ipairs(state.chats) do if chat.id==state.current then refs.chats.selected_index=i;break end end
 -- Progress updates never recreate a transcript the player is reading.
 if not previous or helpers.table_to_json(previous.messages or {})~=helpers.table_to_json(state.messages or {}) or previous.answer~=state.answer or previous.current~=state.current then
  local position=refs.history.vertical_scroll_position
  refs.conversation.clear()
  local messages=state.messages or (#state.answer>0 and {{role='assistant',text=state.answer}} or {})
  if #messages==0 then label(refs.conversation,'What shall we build?',410,'heading_2_label') end
  for _,message in ipairs(messages) do
   local row=refs.conversation.add{type='flow',direction='vertical'}
   row.style.vertical_spacing=4
   local author=label(row,message.role=='user' and player.name or 'Toby',410,'heading_2_label')
   author.style.font_color=message.role=='user' and {r=0.75,g=0.75,b=0.75} or {r=1,g=0.8,b=0.45}
   label(row,message.text,410)
  end
  if not previous or previous.current~=state.current then refs.history.scroll_to_bottom()
  else refs.history.vertical_scroll_position=position end
 end
 refs.activity.clear()
 if #(state.activity or {})==0 then label(refs.activity,'Tool activity will appear here.',410) end
 for _,entry in ipairs(state.activity or {}) do label(refs.activity,entry.text,410) end
 refs.design.clear()
 if state.blueprint then
  label(refs.design,state.design or 'Latest blueprint',410,'heading_2_label')
  label(refs.design,'Blueprint design',410)
  local actions=refs.design.add{type='flow',direction='vertical'}
  actions.add{type='button',name=PREFIX..'inspect-blueprint',caption='Open blueprint',tooltip='Inspect in Factorio’s blueprint editor · Ctrl+Shift+Enter from the message input'}
  actions.add{type='button',name=PREFIX..'blueprint',caption='Place ghosts',style='confirm_button',tooltip='Put the design in your cursor. Construction uses your ordinary items.'}
  if #(state.materials or {})>0 then
   label(refs.design,'Construction materials',410,'heading_2_label')
   local materials=refs.design.add{type='table',column_count=2}
   for _,item in ipairs(state.materials) do
    label(materials,prototypes.item[item.name] and '[item='..item.name..'] '..item.name or item.name,330)
    label(materials,tostring(item.count),70)
   end
  end
 else label(refs.design,'No blueprint in this conversation yet.',410) end
end
local function open(player)
 panel(player)
 local state=storage.players[player.index]
 if state then local old=storage.players[player.index];storage.players[player.index]=nil;update(player.index,old) end
 emit(player,'refresh')
end
script.on_init(function()
 storage.players={};storage.drafts={};storage.tabs={};storage.gui={};storage.sequence=0
 drone.init()
 for _,player in pairs(game.players) do button(player) end
end)
script.on_configuration_changed(function()
 drone.init()
 storage.players=storage.players or {};storage.drafts=storage.drafts or {};storage.tabs=storage.tabs or {};storage.gui=storage.gui or {}
 for _,player in pairs(game.players) do
  button(player)
  local old=player.gui.screen[PREFIX..'panel']
  if old then
   local refs=storage.gui[player.index]
   storage.drafts[player.index]=refs and refs.message.text or old[PREFIX..'message'].text
   old.destroy();open(player)
  end
 end
end)
script.on_event(defines.events.on_player_created,function(event) button(game.get_player(event.player_index)) end)
script.on_event(defines.events.on_player_joined_game,function(event) button(game.get_player(event.player_index)) end)
script.on_event('facmandu-toby-toggle',function(event)
 local player=game.get_player(event.player_index)
 local frame=player.gui.screen[PREFIX..'panel']
 if frame then frame.destroy() else open(player) end
end)
script.on_event('facmandu-toby-claim-drone',function(event)
 local player=game.get_player(event.player_index)
 local ok,message=pcall(drone.bind,player,player.selected)
 if not ok then player.print(message);return end
 open(player);storage.gui[player.index].tabs.selected_tab_index=4;storage.tabs[player.index]=4
end)
script.on_event('facmandu-toby-open-drone',function(event)
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
script.on_event('facmandu-toby-design',function(event) take_blueprint(game.get_player(event.player_index),true) end)
local function send(player)
 local refs=storage.gui[player.index]
 if not refs or not refs.frame.valid then return end
 local text=refs.message.text:match('^%s*(.-)%s*$')
 if #text>0 and #text<=6000 then emit(player,'send',text,selected(player));refs.message.text='';storage.drafts[player.index]='' end
end
script.on_event(defines.events.on_gui_confirmed,function(event)
 if event.element.valid and event.element.name==PREFIX..'message' then
  local player=game.get_player(event.player_index)
  if event.control and event.shift then take_blueprint(player,true) else send(player) end
 end
end)
script.on_event(defines.events.on_gui_click,function(event)
 local element=event.element
 if not element.valid then return end
 local player=game.get_player(event.player_index)
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
script.on_event(defines.events.on_built_entity,drone.built)
script.on_nth_tick(60,function()
 drone.tick()
 for index,refs in pairs(storage.gui or {}) do
  if refs.frame.valid then local player=game.get_player(index);if player then drone_status(player,refs) end end
 end
end)
script.on_event(defines.events.on_gui_text_changed,function(event)
 if event.element.valid and event.element.name==PREFIX..'message' then storage.drafts[event.player_index]=bounded_text(event.element.text,6000) end
end)
script.on_event(defines.events.on_gui_selection_state_changed,function(event)
 if event.element.valid and event.element.name==PREFIX..'chats' then
  local player=game.get_player(event.player_index)
  emit(player,'select',nil,selected(player))
 end
end)
script.on_event(defines.events.on_gui_selected_tab_changed,function(event)
 if event.element.valid and event.element.name==PREFIX..'tabs' then storage.tabs[event.player_index]=event.element.selected_tab_index end
end)
remote.add_interface('facmandu-assistant',{update_player=update,open_player=function(index) local player=game.get_player(index);if not player then error('Player not found',0) end open(player);return true end})
script.on_event(defines.events.on_gui_closed,function(event)
 if event.element and event.element.valid and event.element.name==PREFIX..'panel' then event.element.destroy() end
end)
