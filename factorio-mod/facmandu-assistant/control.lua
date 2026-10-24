local bootstrap=require('events').scope('bootstrap')
bootstrap.on_init(function() storage.planner={} end)
bootstrap.on_configuration_changed(function() storage.planner=storage.planner or {} end)
require('planner.control')
require('planner.api')
require('planner.layout')
require('sandbox')
local events=require('events').scope('toby')
local PREFIX='facmandu-toby-'
local drone=require('drone')
local references=require('references')
local books=require('planner.books')
require('task-board')
local function drone_status(player,refs)
 local state=drone.read(player.force.name,player.name)
 refs.drone_status.caption=state.available and ('Toby · '..state.display) or 'Waiting for your character'
 refs.drone_work.caption=state.activity and state.activity.message or 'Ready'
 refs.drone_details.caption=state.available and (state.mode..' · '..state.surface..' ['..math.floor(state.position.x)..', '..math.floor(state.position.y)..']\n'..(state.ghosts or 0)..' ghosts placed · '..(state.job and ('Job #'..state.job.id..' · '..state.job.state) or 'No active job')) or ''
 refs.drone_follow.enabled=state.available;refs.drone_stay.enabled=state.available
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
local function draft_key(player,state)
 return tostring(state and state.forceIndex or player.force.index)..'/'..(state and state.current or 'new')
end
local function remember_draft(player)
 local refs=storage.gui[player.index]
 local text=refs and refs.message.valid and refs.message.text or storage.drafts[player.index] or ''
 storage.chat_drafts=storage.chat_drafts or {}
 local drafts=storage.chat_drafts[player.index] or {}
 storage.chat_drafts[player.index]=drafts
 drafts[draft_key(player,storage.players[player.index])]=text
 storage.drafts[player.index]=text
end
local function button(player)
 local existing=player.gui.top[PREFIX..'open']
 if existing and existing.type~='sprite-button' then existing.destroy() end
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
 local width=math.floor(math.max(480,math.min(1120,player.display_resolution.width/player.display_scale-80)))
 local height=math.floor(math.max(460,math.min(820,player.display_resolution.height/player.display_scale-120)))
 local compact=width<700
 local sidebar_width=compact and 112 or 250
 local content_width=width-sidebar_width-74
 local text_width=content_width-22
 local frame=player.gui.screen.add{type='frame',name=PREFIX..'panel',direction='vertical'}
 frame.style.width=width;frame.location={x=16,y=64}
 local title=frame.add{type='flow',direction='horizontal',style='frame_header_flow'}
 title.drag_target=frame
 title.add{type='sprite',sprite='toby-launcher'}.style.size=24
 label(title,'Toby',70,'toby_planner_label_frame_title').ignored_by_interaction=true
 local handle=title.add{type='empty-widget',style='toby_flib_titlebar_drag_handle',ignored_by_interaction=true}
 handle.style.horizontally_stretchable=true;handle.drag_target=frame
 title.add{type='sprite-button',name=PREFIX..'close',sprite='utility/close',style='toby_planner_button_frame',tooltip='Close · Your draft is kept'}
 local layout=frame.add{type='flow',direction='horizontal'}
 layout.style.horizontal_spacing=12
 local sidebar=layout.add{type='frame',style='inside_deep_frame',direction='vertical'}
 sidebar.style.width=sidebar_width;sidebar.style.height=height-24;sidebar.style.padding=0
 local menu=sidebar.add{type='frame',direction='horizontal',style='subheader_frame'}
 menu.style.width=sidebar_width
 label(menu,'Chats',sidebar_width-64,'heading_2_label')
 menu.add{type='sprite-button',name=PREFIX..'new',sprite='utility/add',style='toby_flib_tool_button_light_green',tooltip='New conversation · Other tasks keep working'}
 local chats=sidebar.add{type='drop-down',name=PREFIX..'chats',items={'New conversation'},selected_index=1,visible=false}
 local task_scroll=sidebar.add{type='scroll-pane',direction='vertical',horizontal_scroll_policy='never'}
 task_scroll.style.horizontally_stretchable=true;task_scroll.style.vertically_stretchable=true
 local tasks=task_scroll.add{type='flow',direction='vertical'}
 tasks.style.width=sidebar_width;tasks.style.vertical_spacing=0
 local footer=sidebar.add{type='frame',direction='horizontal',style='subfooter_frame'}
 footer.style.width=sidebar_width
 local scope=label(footer,'Shared with '..player.force.name,sidebar_width-24)
 scope.style.font_color={r=.75,g=.75,b=.75}
 local body=layout.add{type='flow',direction='vertical'}
 body.style.width=content_width
 body.style.vertical_spacing=8
 local heading=label(body,'Toby',content_width,'frame_title')
 heading.style.single_line=true
 local metadata=label(body,'Shared with '..player.force.name,content_width)
 metadata.style.font_color={r=.75,g=.75,b=.75}
 local status=label(body,'Type a message to Toby.',content_width)
 status.style.font_color={r=.75,g=.75,b=.75}
 local tabs=body.add{type='tabbed-pane',name=PREFIX..'tabs'}
 tabs.style.horizontally_stretchable=true
 local refs={frame=frame,chats=chats,status=status,heading=heading,metadata=metadata,tabs=tabs,tasks=tasks,
  content_width=text_width,sidebar_width=sidebar_width,task_cards={}}
 for _,entry in ipairs{{'conversation','Chat'},{'activity',compact and 'Tools' or 'Activity'},{'design',compact and 'Plan' or 'Design'}} do
  local tab=tabs.add{type='tab',caption=entry[2]}
  if compact then tab.style.minimal_width=0;tab.style.width=math.floor(content_width/5)-4 end
  local content=tabs.add{type='scroll-pane',name=PREFIX..entry[1],direction='vertical',horizontal_scroll_policy='never'}
  content.style.width=content_width;content.style.height=height-260
  local rows=content.add{type='flow',direction='vertical'}
  rows.style.vertical_spacing=12;rows.style.width=text_width
  tabs.add_tab(tab,content);refs[entry[1]]=rows
  if entry[1]=='conversation' then refs.history=content end
 end
 local drone_tab=tabs.add{type='tab',caption='Drone'}
 if compact then drone_tab.style.minimal_width=0;drone_tab.style.width=math.floor(content_width/5)-4 end
 local drone_content=tabs.add{type='flow',direction='vertical'}
 drone_content.style.width=content_width;drone_content.style.height=height-260
 refs.drone_status=label(drone_content,'',text_width,'heading_2_label')
 drone_content.add{type='sprite',sprite='entity/toby-drone'}.style.size=64
 refs.drone_work=label(drone_content,'Ready',text_width)
 refs.drone_details=label(drone_content,'',text_width)
 label(drone_content,'Nearby ghosts are built with your items.',text_width)
 local drone_actions=drone_content.add{type='flow',direction='horizontal'}
 refs.drone_follow=drone_actions.add{type='button',name=PREFIX..'drone-follow',caption='Follow me',style='toby_planner_button_frame_tool'}
 refs.drone_stay=drone_actions.add{type='button',name=PREFIX..'drone-stay',caption='Stay here',style='toby_planner_button_frame_tool'}
 tabs.add_tab(drone_tab,drone_content)
 local book_tab=tabs.add{type='tab',caption='Books'}
 if compact then book_tab.style.minimal_width=0;book_tab.style.width=math.floor(content_width/5)-4 end
 local book_content=tabs.add{type='scroll-pane',direction='vertical',horizontal_scroll_policy='never'}
 book_content.style.width=content_width;book_content.style.height=height-260
 refs.books=book_content.add{type='flow',direction='vertical'}
 refs.books.style.width=text_width
 tabs.add_tab(book_tab,book_content)
 tabs.selected_tab_index=math.min(5,storage.tabs[player.index] or 1)
 drone_status(player,refs)
 local composer=body.add{type='textfield',name=PREFIX..'message',text=storage.drafts[player.index] or '',tooltip='Message Toby · Enter to send'}
 composer.style.width=content_width;composer.style.height=36
 local actions=body.add{type='flow',direction='horizontal'}
 actions.style.width=content_width
 local context=actions.add{type='label',caption=player.surface.name}
 context.style.font_color={r=.75,g=.75,b=.75}
 actions.add{type='empty-widget',style='toby_flib_horizontal_pusher'}
 local stop=actions.add{type='button',name=PREFIX..'stop',caption='Stop',visible=false,style='toby_planner_button_frame_tool'}
 local send=actions.add{type='button',name=PREFIX..'send',caption='Send',style='toby_planner_button_green',tooltip='Send a message to Toby · Enter'}
 refs.message=composer;refs.stop=stop;refs.send=send;refs.context=context
 storage.gui[player.index]=refs
 player.opened=frame;composer.focus()
 return refs
end
local function selected(player)
 local state=storage.players[player.index]
 local refs=storage.gui[player.index]
 local index=refs and refs.frame.valid and refs.chats.selected_index
 return state and state.chats and state.chats[index or 0] and state.chats[index].id
end
local function render_books(player,refs)
 books.init()
 local version=storage.book_versions[player.force.index] or 0
 if refs.book_version==version and refs.book_force==player.force.index then return end
 refs.book_version=version;refs.book_force=player.force.index
 refs.books.clear()
 label(refs.books,'Toby books · '..player.force.name,refs.content_width,'heading_2_label')
 label(refs.books,'Saved in this game and shared with your force. Take a book, then drag it into Factorio’s Game blueprints tab. Mods cannot create library records directly.',refs.content_width)
 local actions=refs.books.add{type='flow',direction='horizontal'}
 actions.add{type='button',name=PREFIX..'take-book',caption='Take Toby book',style='toby_planner_button_green'}
 actions.add{type='button',name=PREFIX..'update-book',caption='Update held book',style='toby_planner_button_frame_tool',tooltip='Append current Toby designs to the book in your cursor. Existing entries and your edits are preserved.'}
 local pending=storage.book_sync[player.force.index] or 0
 if pending>0 then label(refs.books,'Book sync incomplete: '..pending..' designs or revisions could not be saved. The save retains up to 32 designs and 64 prior revisions per design; existing designs are preserved.',refs.content_width).style.font_color={r=1,g=.8,b=.45} end
 local entries=books.list(player.force)
 if #entries==0 then label(refs.books,'No saved designs yet.',refs.content_width) end
 for _,entry in ipairs(entries) do
  local row=refs.books.add{type='frame',style='inside_deep_frame',direction='vertical'}
  row.style.width=refs.content_width
  label(row,entry.title,refs.content_width-20,'heading_2_label')
  label(row,entry.design,refs.content_width-20)
  row.add{type='button',caption='Take blueprint',style='toby_planner_button_frame_tool',tags={toby_book_entry=entry.id}}
 end
end
local function render_tasks(refs,state)
 local signature=helpers.table_to_json{chats=state.chats,current=state.current,running=state.running,status=state.status}
 if signature==refs.task_signature then return end
 refs.tasks.clear();refs.task_cards={}
 for i,chat in ipairs(state.chats) do
  local running=chat.state=='running' or (chat.id==state.current and state.running==true)
  local status=chat.status or (chat.id==state.current and state.status) or 'Ready'
  local outcome=running and 'Working' or (chat.state=='done' and 'Done' or chat.state=='error' and 'Needs attention' or 'Ready')
  local tooltip=chat.title..'\n'..outcome..' · '..status..(chat.author and ('\nStarted by '..chat.author) or '')
  local row=refs.tasks.add{type='flow',direction='horizontal'}
  row.style.horizontal_spacing=0
  local button=row.add{type='button',caption=chat.title,style='list_box_item',tags={toby_chat_index=i},tooltip=tooltip,toggled=chat.id==state.current}
  button.style.width=refs.sidebar_width-32;button.style.height=40;button.style.padding={0,4,0,12}
  local sprite=running and 'utility/clock' or chat.state=='done' and 'utility/check_mark_green' or chat.state=='error' and 'utility/warning_icon' or 'utility/status_blue'
  local marker=row.add{type='sprite-button',sprite=sprite,style='toby_planner_sprite-button_move',tags={toby_chat_index=i},tooltip=tooltip,toggled=chat.id==state.current}
  marker.style.size={32,40};marker.style.padding=8
  refs.task_cards[#refs.task_cards+1]={running=running,marker=marker}
 end
 if #state.chats==0 then label(refs.tasks,'No conversations yet.\nUse + to start a chat.',refs.sidebar_width-24).style.margin=12 end
 refs.task_signature=signature
end
local function update(player_index,state)
 local player=game.get_player(player_index)
 if not player then error('Player not found',0) end
 if type(state)~='table' or type(state.status)~='string' or #state.status>500 or type(state.answer)~='string' or #state.answer>6000 then error('Invalid panel update',0) end
 if state.force and state.force~=player.force.name then error('Player force changed before panel delivery',0) end
 if state.blueprints then
  if type(state.blueprints)~='table' or #state.blueprints>8 then error('Expected up to eight saved designs',0) end
  local bytes=0
  for _,artifact in ipairs(state.blueprints) do
   if type(artifact)~='table' or type(artifact.id)~='string' or #artifact.id~=64 or not artifact.id:match('^%x+$') then error('Invalid saved design ID',0) end
   for _,field in ipairs{'designId','revisionOf'} do
    local value=artifact[field]
    if value~=nil and (type(value)~='string' or #value~=64 or not value:match('^[a-f0-9]+$')) then error('Invalid saved design '..field,0) end
   end
   if artifact.revisionOf and (not artifact.designId or artifact.revisionOf==artifact.designId) then error('Invalid saved design ancestry',0) end
   for field,limit in pairs{chatId=100,title=200,label=200} do if type(artifact[field])~='string' or #artifact[field]>limit then error('Invalid saved design '..field,0) end end
   if type(artifact.blueprint)~='string' or #artifact.blueprint>65536 or not artifact.blueprint:match('^0[%w+/=]+$') then error('Invalid saved blueprint',0) end
   bytes=bytes+#artifact.blueprint
  end
  if bytes>98304 then error('Saved design packet too large',0) end
 end
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
   if row.author and (type(row.author)~='string' or #row.author>200) then error('Invalid message author',0) end
   bytes=bytes+#row.text
  end
  if bytes>12000 then error('Panel content too large',0) end
 end
 local items={}
 for _,chat in ipairs(state.chats) do
  if type(chat.id)~='string' or #chat.id>100 or type(chat.title)~='string' or #chat.title>200 then error('Invalid chat',0) end
  if chat.state and chat.state~='idle' and chat.state~='running' and chat.state~='done' and chat.state~='error' then error('Invalid chat state',0) end
  if chat.status and (type(chat.status)~='string' or #chat.status>500) then error('Invalid chat status',0) end
  if chat.author and (type(chat.author)~='string' or #chat.author>200) then error('Invalid chat author',0) end
  items[#items+1]=chat.title
 end
 if state.drone then drone.activity(player,state.drone) end
 state.forceIndex=player.force.index
 local old=storage.players[player.index]
 local changed=draft_key(player,old)~=draft_key(player,state)
 if changed then
  remember_draft(player)
  local drafts=storage.chat_drafts[player.index]
  storage.drafts[player.index]=drafts[draft_key(player,state)] or ''
 end
 storage.players[player.index]=state
 local receipt=books.remember(player,state)
 button(player)
 local refs=storage.gui[player.index]
 if changed and refs and refs.message.valid then refs.message.text=storage.drafts[player.index] end
 if not refs or not refs.frame.valid or not refs.frame.visible then return receipt end
 render_tasks(refs,state)
 if refs.tabs.selected_tab_index==5 then render_books(player,refs) end
 local current
 for _,chat in ipairs(state.chats) do if chat.id==state.current then current=chat;break end end
 refs.heading.caption=current and current.title or 'Toby'
 refs.metadata.caption=current and ((current.author and ('Started by '..current.author..' · ') or '')..'Shared with '..player.force.name) or ('Shared with '..player.force.name)
 refs.status.caption=state.status
 refs.status.style.font_color=current and current.state=='error' and {r=1,g=.4,b=.3} or state.running and {r=1,g=.8,b=.45} or {r=.75,g=.75,b=.75}
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
    label(row,'',refs.content_width,'heading_2_label');label(row,'',refs.content_width)
   end
   local author=row.children[1]
   author.caption=message.role=='user' and (message.author or 'Player') or 'Toby'
   author.style.font_color=message.role=='user' and {r=0.75,g=0.75,b=0.75} or {r=1,g=0.8,b=0.45}
   local text=message.text
   if message.author and text:sub(1,#message.author+2)==message.author..': ' then text=text:sub(#message.author+3) end
   if row.children[2].caption~=text then
    row.children[2].caption=text
    if row.children[3] then row.children[3].destroy() end
    references.text(row,text)
   end
  end
  for i=#refs.conversation.children,#messages+1,-1 do refs.conversation.children[i].destroy() end
  if #messages==0 then label(refs.conversation,'What shall we build?',refs.content_width,'heading_2_label') end
  if not refs.message_signature or refs.conversation_chat~=state.current then refs.history.scroll_to_bottom() end
  refs.message_signature=message_signature;refs.conversation_chat=state.current
 end
 local activity_signature=helpers.table_to_json{activity=state.activity,current=state.current,running=state.running,status=#(state.activity or {})==0 and state.status or nil}
 if refs.tabs.selected_tab_index==2 and refs.activity_signature~=activity_signature then
  if refs.activity.children[1] and refs.activity.children[1].type~='frame' then refs.activity.clear() end
  for i,entry in ipairs(state.activity or {}) do
   local card=refs.activity.children[i]
   if not card then card=refs.activity.add{type='frame',style='inside_shallow_frame',direction='vertical'};card.style.width=refs.content_width;label(card,'',refs.content_width-20) end
   if card.children[1].caption~=entry.text then
    card.children[1].caption=entry.text
    if card.children[2] then card.children[2].destroy() end
    references.text(card,entry.text)
   end
  end
  for i=#refs.activity.children,#(state.activity or {})+1,-1 do refs.activity.children[i].destroy() end
  if #(state.activity or {})==0 then label(refs.activity,state.running and state.status or 'No tools used in this turn.',refs.content_width) end
  refs.activity_signature=activity_signature
 end
 local design_signature=helpers.table_to_json{blueprint=state.blueprint,design=state.design,stage=state.designStage,warnings=state.designWarnings,materials=state.materials,current=state.current,running=state.running}
 if refs.tabs.selected_tab_index==3 and refs.design_signature~=design_signature then
  refs.design.clear()
  if state.blueprint then
   label(refs.design,state.designStage or 'Design',refs.content_width,'heading_2_label')
   label(refs.design,state.design or 'Latest blueprint',refs.content_width)
   for _,warning in ipairs(state.designWarnings or {}) do
    local row=label(refs.design,warning,refs.content_width);row.style.font_color={r=1,g=0.75,b=0.3}
   end
   local actions=refs.design.add{type='flow',direction='horizontal'}
   actions.add{type='button',name=PREFIX..'inspect-blueprint',caption='Inspect blueprint',tooltip='Open Factorio’s blueprint editor · Ctrl+Shift+Enter'}
   actions.add{type='button',name=PREFIX..'blueprint',caption='Take blueprint',style='confirm_button',tooltip='Put the design in your cursor to place ghosts.'}
   if #(state.materials or {})>0 then
    label(refs.design,'Materials · Alt-click to inspect',refs.content_width,'heading_2_label')
    local materials=refs.design.add{type='table',column_count=8}
    for _,item in ipairs(state.materials) do references.add(materials,'item',item.name,item.count) end
   end
  else label(refs.design,state.running and 'Design in progress. Validated drafts appear here as they are created.' or 'No design created in this chat.',refs.content_width) end
  refs.design_signature=design_signature
 end
 drone_status(player,refs)
 return receipt
end
local function open(player)
 local refs=panel(player)
 refs.frame.visible=true
 if refs.tabs.selected_tab_index==5 then render_books(player,refs) end
 player.opened=refs.frame
 local state=storage.players[player.index]
 if state then update(player.index,state) end
 emit(player,'refresh')
end
events.on_init(function()
 storage.players={};storage.drafts={};storage.chat_drafts={};storage.tabs={};storage.gui={};storage.sequence=0
 books.init()
 drone.init()
 for _,player in pairs(game.players) do button(player) end
end)
events.on_configuration_changed(function()
 books.init()
 drone.init()
 storage.players=storage.players or {};storage.drafts=storage.drafts or {};storage.chat_drafts=storage.chat_drafts or {};storage.tabs=storage.tabs or {};storage.gui=storage.gui or {}
 for _,player in pairs(game.players) do
  button(player)
  local old=player.gui.screen[PREFIX..'panel']
  if old then
   old.destroy();open(player)
  end
 end
end)
events.on_event(defines.events.on_player_created,function(event) button(game.get_player(event.player_index)) end)
local function rebuild_panel(event)
 local player=game.get_player(event.player_index)
 button(player)
 local frame=player.gui.screen[PREFIX..'panel']
 if not frame then return end
 local refs=storage.gui[player.index]
 remember_draft(player)
 if refs and refs.tabs.valid then storage.tabs[player.index]=refs.tabs.selected_tab_index end
 local visible=frame.visible
 frame.destroy()
 if visible then open(player) end
end
-- Rebuild cached GUI layout after joining or changing display size/scale.
events.on_event({defines.events.on_player_joined_game,defines.events.on_player_display_resolution_changed,
 defines.events.on_player_display_scale_changed},rebuild_panel)
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
 if #text>0 and #text<=6000 then emit(player,'send',text,storage.players[player.index] and storage.players[player.index].current);refs.message.text='';storage.drafts[player.index]='';remember_draft(player) end
end
events.on_event(defines.events.on_gui_confirmed,function(event)
 if event.element.valid and event.element.name==PREFIX..'message' then
  local player=game.get_player(event.player_index)
  if event.control and event.shift then take_blueprint(player,true) else send(player) end
 end
end)
events.on_event(defines.events.on_gui_click,function(event)
 local element=event.element
 if not element or not element.valid then return end
 local player=game.get_player(event.player_index)
 if element.tags and element.tags.toby_chat_index then
  local refs=storage.gui[player.index]
  refs.chats.selected_index=element.tags.toby_chat_index
  emit(player,'select',nil,selected(player))
  return
 end
 if element.tags and element.tags.toby_book_entry then
  for _,entry in ipairs(books.list(player.force)) do
   if entry.id==element.tags.toby_book_entry then
    if not player.clear_cursor() then player.print('Clear inventory space before taking the blueprint.');return end
    if player.cursor_stack.import_stack(entry.blueprint)~=0 then player.print('Could not import this blueprint.');return end
    storage.gui[player.index].frame.destroy();return
   end
  end
  return
 end
 if references.click(player,element) then return end
 local name=element.name
 local refs=storage.gui[player.index]
 if name==PREFIX..'open' then open(player)
 elseif name==PREFIX..'close' then refs.frame.destroy()
 elseif name==PREFIX..'send' then
  send(player)
 elseif name==PREFIX..'take-book' or name==PREFIX..'update-book' then
  local ok,message=pcall(books.take,player,name==PREFIX..'update-book')
  if not ok then player.print(message) else refs.frame.destroy() end
 elseif name==PREFIX..'new' then emit(player,'new')
 elseif name==PREFIX..'stop' then
  local current=drone.read(player.force.name,player.name)
  if current.available and current.job and (current.job.state=='travelling' or current.job.state=='placing')then pcall(drone.command,player.force.name,player.name,'stay',current)end
  emit(player,'stop',nil,storage.players[player.index] and storage.players[player.index].current)
 elseif name==PREFIX..'drone-follow' or name==PREFIX..'drone-stay' then
  local state=drone.read(player.force.name,player.name)
  local ok,message=pcall(drone.command,player.force.name,player.name,name==PREFIX..'drone-follow' and 'follow' or 'stay',state)
  if not ok then player.print(message) end
  drone_status(player,refs)
 elseif name==PREFIX..'blueprint' or name==PREFIX..'inspect-blueprint' then
  take_blueprint(player,name==PREFIX..'inspect-blueprint')
 end
end)
events.on_event(defines.events.on_built_entity,drone.built)
events.on_nth_tick(5,function(event)
 drone.tick()
 drone.animate()
 if event.tick%15==0 then
  for _,refs in pairs(storage.gui or {}) do
   if refs.frame.valid and refs.frame.visible then
    for _,card in ipairs(refs.task_cards or {}) do if card.running and card.marker.valid then card.marker.sprite=math.floor(event.tick/15)%2==0 and 'utility/clock' or 'utility/refresh' end end
   end
  end
 end
 if event.tick%60~=0 then return end
 for index,refs in pairs(storage.gui or {}) do
  if refs.frame.valid then local player=game.get_player(index);if player then drone_status(player,refs) end end
 end
end)
events.on_event(defines.events.on_gui_text_changed,function(event)
 if event.element.valid and event.element.name==PREFIX..'message' then
  -- Writing text on every keystroke overwrites multiplayer clients' pending input.
  if #event.element.text>6000 then event.element.text=bounded_text(event.element.text,6000) end
  remember_draft(game.get_player(event.player_index))
 end
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
  if event.element.selected_tab_index==5 then render_books(game.get_player(event.player_index),storage.gui[event.player_index]) end
  local state=storage.players[event.player_index]
  if state then update(event.player_index,state) end
 end
end)
remote.add_interface('facmandu-assistant',{
 attach_plan=function(index,id)
  local player=game.get_player(index)
  if not player then error('Player not found',0) end
  local plan=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,id)
  open(player)
  local refs=storage.gui[index]
  local text=refs.message.text
  if #text>0 then text=text..'\n' end
  text=text..'Plan: '..plan.reference
  if #text>6000 then player.print('Your draft is full. Copy the plan reference: '..plan.reference);return plan.reference end
  refs.message.text=text;remember_draft(player)
  refs.message.focus()
  return plan.reference
 end,
 export_book=function(force_name,player_name)
  local player=game.get_player(player_name)
  if not player or player.force.name~=force_name then error('Choose a player on this force',0) end
  return books.export(player.force)
 end,
 take_book=function(force_name,player_name,update)
  local player=game.get_player(player_name)
  if not player or player.force.name~=force_name then error('Choose a player on this force',0) end
  return books.take(player,update==true)
 end,
 update_player=update,open_player=function(index) local player=game.get_player(index);if not player then error('Player not found',0) end open(player);return true end})
events.on_event(defines.events.on_gui_closed,function(event)
 if event.element and event.element.valid and event.element.visible and event.element.name==PREFIX..'panel' then event.element.destroy() end
end)

events.on_event(defines.events.on_player_changed_force,function(event)
 local player=game.get_player(event.player_index)
 remember_draft(player)
 storage.players[player.index]=nil
 storage.drafts[player.index]=storage.chat_drafts[player.index][draft_key(player,nil)] or ''
 local refs=storage.gui[player.index]
 if refs and refs.frame.valid then refs.frame.destroy() end
end)
events.on_event(defines.events.on_forces_merged,function(event) books.merge(event.source_index,event.destination) end)
