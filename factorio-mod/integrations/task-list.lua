-- Loaded inside Task List so its normal task methods and GUI updates own every edit.
local tasks = require('scripts.task')
local function force_for(name)
 local force=game.forces[name]
 if not force or not storage.forces[force.index] then error('Task List force is unavailable',0) end
 return force
end
local function owner_of(task)
 local owner=task.owner
 for _=1,64 do
  if owner.object_name~='Task' then return owner end
  owner=owner.owner
 end
 error('Task nesting is too deep',0)
end
local function task_for(force,id)
 local task=storage.tasks[id]
 if not task or owner_of(task)~=force then error('Shared force task not found',0) end
 return task
end
local function text(value,limit)
 if type(value)~='string' or #value>limit then error('Task text exceeds its byte limit',0) end
 return value
end
local function status(value)
 if value~='not_started' and value~='in_progress' and value~='paused' and value~='blocked' then error('Invalid task status',0) end
 return value
end
local function snapshot(task)
 return {id=task.id,title=task.title,description=task.description,status=task.status,completed=task.completed,assignee=task.assignee and task.assignee.valid and task.assignee.name or nil}
end
local api={
 read=function(name,limit,completed)
  local force=force_for(name)
  limit=math.min(50,math.max(1,math.floor(tonumber(limit) or 20)))
  local rows,ids={},{}
  for id,task in pairs(storage.tasks) do
   if owner_of(task)==force and (completed or not task.completed) then
    ids[#ids+1]=id
   end
  end
  table.sort(ids)
  local bytes=0
  for _,id in ipairs(ids) do
   local row=snapshot(storage.tasks[id]);bytes=bytes+#helpers.table_to_json(row)
   if #rows>=limit or bytes>6000 then break end
   rows[#rows+1]=row
  end
  return {source='TaskList',visible=true,window='TaskList',force=force.name,tasks=rows,total=#ids,truncated=#ids>#rows}
 end,
 add=function(name,title,description,state)
  local force=force_for(name)
  title=text(title,200);description=text(description,2000);state=status(state)
  if not title:match('%S') then error('Task needs a title',0) end
  local count=0
  for _,task in pairs(storage.tasks) do
   if owner_of(task)==force then
    count=count+1
    if not task.completed and task.title==title and task.description==description and task.status==state then return {task=snapshot(task),created=false,source='TaskList',visible=true,window='TaskList'} end
   end
  end
  if count>=500 then error('Archive completed shared tasks before adding more',0) end
  return {task=snapshot(tasks.new(title,description,force,nil,state,false)),created=true,source='TaskList',visible=true,window='TaskList'}
 end,
 update=function(name,id,expected,title,description,state,completed)
  local task=task_for(force_for(name),id)
  title=text(title,200);description=text(description,2000);state=status(state)
  if not title:match('%S') or type(completed)~='boolean' or type(expected)~='table' then error('Invalid task update',0) end
  for _,key in ipairs({'title','description','status','completed'}) do if task[key]~=expected[key] then error('Task changed; read the board again',0) end end
  task:update(title,description,task.assignee,state)
  if task.completed~=completed then task:toggle_completed() end
  return snapshot(task)
 end
}
function api.import(name,source,rows)
 local force=force_for(name)
 assert(source=='scenario' or source=='toby','Unknown task source')
 assert(type(rows)=='table' and #rows<=50,'Too many tasks to migrate at once')
 for _,row in ipairs(rows) do
  assert(type(row.id)=='number' and row.id>=1 and row.id%1==0,'Invalid task identity')
  assert(text(row.title,200):match('%S'),'Task needs a title');text(row.description,2000);status(row.status)
  assert(type(row.completed)=='boolean','Invalid completion state')
 end
 storage.facmandu_task_imports=storage.facmandu_task_imports or {}
 local imports=storage.facmandu_task_imports
 imports[force.index]=imports[force.index] or {scenario={},toby={}}
 local ids=imports[force.index][source]
 local count=0;for _,task in pairs(storage.tasks) do if owner_of(task)==force then count=count+1 end end
 for _,row in ipairs(rows) do if not ids[row.id] then
  local existing
  for _,task in pairs(storage.tasks) do
   if owner_of(task)==force and task.title==row.title and task.description==row.description and task.completed==row.completed then existing=task;break end
  end
  if not existing then
   assert(count<500,'Archive completed shared tasks before importing more');count=count+1
   existing=tasks.new(row.title,row.description,force,nil,row.status,false)
   if row.completed then existing:toggle_completed() end
  end
  ids[row.id]=existing.id
 end end
 return {imported=true}
end
remote.add_interface('facmandu-task-list',api)
