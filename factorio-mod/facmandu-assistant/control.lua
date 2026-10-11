local PREFIX='facmandu-toby-'
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
  player.gui.top.add{type='button',name=PREFIX..'open',caption='Toby',tooltip='Chat with Toby · Facmandu'}
 end
end
local function panel(player)
 local existing=player.gui.screen[PREFIX..'panel']
 if existing then return existing end
 local frame=player.gui.screen.add{type='frame',name=PREFIX..'panel',caption='Toby',direction='vertical'}
 frame.auto_center=true
 frame.style.width=500
 local header=frame.add{type='flow',direction='horizontal'}
 header.add{type='button',name=PREFIX..'new',caption='New chat'}
 header.add{type='button',name=PREFIX..'stop',caption='Stop'}
 header.add{type='button',name=PREFIX..'close',caption='Close'}
 local chats=frame.add{type='drop-down',name=PREFIX..'chats',items={'Current chat'},selected_index=1}
 chats.style.horizontally_stretchable=true
 local status=frame.add{type='label',name=PREFIX..'status',caption='Connect this server to Facmandu to chat.'}
 status.style.single_line=false
 local answer=frame.add{type='text-box',name=PREFIX..'answer',text='',read_only=true}
 answer.style.width=460;answer.style.height=200
 local input=frame.add{type='text-box',name=PREFIX..'message',text=storage.drafts[player.index] or ''}
 input.style.width=460;input.style.height=70
 frame.add{type='button',name=PREFIX..'send',caption='Send / steer'}
 local blueprint=frame.add{type='button',name=PREFIX..'blueprint',caption='Take blueprint',tooltip='Put the latest design in your cursor. Place it as ordinary ghosts.'}
 blueprint.enabled=false
 player.opened=frame
 return frame
end
local function selected(player)
 local state=storage.players[player.index]
 local frame=player.gui.screen[PREFIX..'panel']
 local index=frame and frame[PREFIX..'chats'].selected_index
 return state and state.chats and state.chats[index or 0] and state.chats[index].id
end
local function update(player_index,state)
 local player=game.get_player(player_index)
 if not player then error('Player not found',0) end
 if type(state)~='table' or type(state.status)~='string' or #state.status>500 or type(state.answer)~='string' or #state.answer>6000 then error('Invalid panel update',0) end
 if type(state.chats)~='table' or #state.chats>8 then error('Expected up to eight chats',0) end
 if state.blueprint and (type(state.blueprint)~='string' or #state.blueprint>65536 or not state.blueprint:match('^0[%w+/=]+$')) then error('Invalid blueprint',0) end
 local items={}
 for _,chat in ipairs(state.chats) do
  if type(chat.id)~='string' or #chat.id>100 or type(chat.title)~='string' or #chat.title>200 then error('Invalid chat',0) end
  items[#items+1]=chat.title
 end
 storage.players[player.index]=state
 button(player)
 local frame=player.gui.screen[PREFIX..'panel']
 if not frame then return end
 frame[PREFIX..'status'].caption=state.status
 frame[PREFIX..'answer'].text=state.answer
 frame[PREFIX..'blueprint'].enabled=state.blueprint~=nil
 local dropdown=frame[PREFIX..'chats']
 dropdown.items=#items>0 and items or {'Current chat'}
 for i,chat in ipairs(state.chats) do if chat.id==state.current then dropdown.selected_index=i;break end end
end
script.on_init(function()
 storage.players={};storage.drafts={};storage.sequence=0
 for _,player in pairs(game.players) do button(player) end
end)
script.on_configuration_changed(function()
 storage.players=storage.players or {};storage.drafts=storage.drafts or {}
 for _,player in pairs(game.players) do
  button(player)
  local old=player.gui.screen[PREFIX..'panel']
  if old then
   storage.drafts[player.index]=old[PREFIX..'message'].text
   old.destroy();panel(player)
   if storage.players[player.index] then update(player.index,storage.players[player.index]) end
  end
 end
end)
script.on_event(defines.events.on_player_created,function(event) button(game.get_player(event.player_index)) end)
script.on_event(defines.events.on_player_joined_game,function(event) button(game.get_player(event.player_index)) end)
script.on_event(defines.events.on_gui_click,function(event)
 local element=event.element
 if not element.valid then return end
 local player=game.get_player(event.player_index)
 local name=element.name
 if name==PREFIX..'open' then
  panel(player)
  local state=storage.players[player.index]
  if state then update(player.index,state) end
  emit(player,'refresh')
 elseif name==PREFIX..'close' then player.gui.screen[PREFIX..'panel'].destroy()
 elseif name==PREFIX..'send' then
  local input=player.gui.screen[PREFIX..'panel'][PREFIX..'message']
  local text=input.text:match('^%s*(.-)%s*$')
  if #text>0 and #text<=6000 then emit(player,'send',text,selected(player));input.text='';storage.drafts[player.index]='' end
 elseif name==PREFIX..'new' then emit(player,'new')
 elseif name==PREFIX..'stop' then emit(player,'stop',nil,selected(player)) end
 if name==PREFIX..'blueprint' then
  local state=storage.players[player.index]
  if state and state.blueprint then
   if not player.clear_cursor() then player.print('Clear some inventory space before taking the blueprint.');return end
   local ok,result=pcall(player.cursor_stack.import_stack,state.blueprint)
   if not ok or result~=0 then player.print('Factorio could not import this blueprint.');return end
   player.gui.screen[PREFIX..'panel'].destroy()
  end
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
remote.add_interface('facmandu-assistant',{update_player=update,open_player=function(index) local player=game.get_player(index);if not player then error('Player not found',0) end panel(player);local state=storage.players[index];if state then update(index,state) end;emit(player,'refresh');return true end})
script.on_event(defines.events.on_gui_closed,function(event)
 if event.element and event.element.valid and event.element.name==PREFIX..'panel' then event.element.destroy() end
end)
