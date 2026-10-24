local events=require('events').scope('task-board')
local store=require('task-store')
local M={}
local PREFIX='facmandu-toby-task-'
local statuses={'not_started','in_progress','paused','blocked'}
local captions={'Not started','In progress','Paused','Blocked'}
local function force_for(name) return assert(game.forces[name],'Force no longer exists') end
local function snapshot(task) return {id=task.id,title=task.title,description=task.description,status=task.status,completed=task.completed} end
local function refresh(force)
 for index,refs in pairs(storage.gui or {}) do
  local player=game.get_player(index)
  if player and player.force==force then M.render(refs,player) end
 end
end
function M.read(force,limit,completed)
 local result=store.read(storage,force,math.max(1,math.min(50,limit or 20)),completed)
 result.visible=true;result.window='Toby → Tasks';return result
end
function M.render(refs,player)
 if not refs.task_rows or not refs.task_rows.valid then return end
 local board=M.read(player.force,50,true);local signature=helpers.table_to_json(board)
 if refs.task_board_signature==signature then return end
 refs.task_rows.clear()
 local width=refs.content_width
 if board.total==0 then refs.task_rows.add{type='label',caption='No shared tasks yet.'} end
 for _,task in ipairs(board.tasks) do
  local card=refs.task_rows.add{type='frame',direction='vertical',style='inside_shallow_frame'}
  card.style.width=width;card.style.padding=8
  local row=card.add{type='flow',direction='horizontal'}
  local check=row.add{type='checkbox',name=PREFIX..'complete',state=task.completed,caption='',tags={task=snapshot(task)},tooltip='Mark task complete'}
  local title=row.add{type='label',caption='#'..task.id..' · '..task.title}
  title.style.width=math.max(80,width-82);title.style.single_line=false
  row.add{type='sprite-button',name=PREFIX..'edit',sprite='utility/rename_icon',style='tool_button',tooltip='Edit task',tags={task=snapshot(task)}}
  local status=card.add{type='drop-down',name=PREFIX..'status',items=captions,tags={task=snapshot(task)}}
  for i,value in ipairs(statuses) do if task.status==value then status.selected_index=i end end
  status.enabled=not task.completed
  if #task.description>0 then
   local description=card.add{type='label',caption=task.description};description.style.width=width-20;description.style.single_line=false
  end
 end
 if board.truncated then refs.task_rows.add{type='label',caption='Showing 50 of '..board.total..' shared tasks.'} end
 refs.task_board_signature=signature
end
local function edit(player,task)
 local refs=storage.gui[player.index];refs.task_editor.clear()
 refs.task_editor.visible=true;refs.task_scroll.visible=false
 local frame=refs.task_editor.add{type='frame',name=PREFIX..'editor',caption='Edit shared task #'..task.id,direction='vertical',tags={task=task}}
 local width=math.max(80,refs.content_width-20)
 local title=frame.add{type='textfield',name='title',text=task.title};title.style.width=width
 local description=frame.add{type='text-box',name='description',text=task.description};description.style.width=width;description.style.height=120;description.word_wrap=true
 local buttons=frame.add{type='flow',direction='horizontal'}
 buttons.add{type='button',name=PREFIX..'save',caption='Save',style='confirm_button'}
 buttons.add{type='button',name=PREFIX..'cancel',caption='Cancel'}
 title.focus()
end
local function handle(event)
 local element=event.element
 if not element or not element.valid or not element.name:find(PREFIX,1,true) then return end
 local player=game.get_player(event.player_index);if not player then return end
 local task=element.tags.task
 if element.name==PREFIX..'edit' then edit(player,task);return end
 if element.name==PREFIX..'cancel' then local refs=storage.gui[player.index];refs.task_editor.clear();refs.task_editor.visible=false;refs.task_scroll.visible=true;return end
 local ok,err=pcall(function()
  if element.name==PREFIX..'add' then
   local refs=storage.gui[player.index];local title=refs.task_title.text
   if not title:match('%S') then return end
   store.add(storage,player.force,title,'','not_started');refs.task_title.text=''
  elseif element.name==PREFIX..'save' then
   local refs=storage.gui[player.index];local frame=refs.task_editor[PREFIX..'editor'];task=frame.tags.task
   store.update(storage,player.force,task.id,task,frame.title.text,frame.description.text,task.status,task.completed);refs.task_editor.clear();refs.task_editor.visible=false;refs.task_scroll.visible=true
  elseif element.name==PREFIX..'complete' or element.name==PREFIX..'status' then
   local completed=task.completed;if element.name==PREFIX..'complete' then completed=element.state end
   store.update(storage,player.force,task.id,task,task.title,task.description,
    element.name==PREFIX..'status' and statuses[element.selected_index] or task.status,
    completed)
  end
 end)
 if not ok then player.print('Toby tasks: '..tostring(err):match('[^\n]*')) end
 refresh(player.force)
end
events.on_event(defines.events.on_gui_click,handle)
events.on_event(defines.events.on_gui_checked_state_changed,handle)
events.on_event(defines.events.on_gui_selection_state_changed,handle)
remote.add_interface('facmandu-toby-tasks',{
 read=function(name,limit,completed) return M.read(force_for(name),limit,completed) end,
 add=function(name,title,description,status) local force=force_for(name);local result=store.add(storage,force,title,description,status);refresh(force);result.visible=true;result.window='Toby → Tasks';return result end,
 update=function(name,id,expected,title,description,status,completed) local force=force_for(name);local result=store.update(storage,force,id,expected,title,description,status,completed);refresh(force);return result end,
 import=function(name,rows) local force=force_for(name);local result=store.import(storage,force,rows);refresh(force);return result end
})
return M
