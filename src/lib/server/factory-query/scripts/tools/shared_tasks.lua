-- Force-owned Toby tasks live in scenario storage, so they travel with the save.
local M={}
local function copy(t) return {id=t.id,title=t.title,description=t.description,status=t.status,completed=t.completed} end
local function fields(title,description,status)
 assert(type(title)=='string' and #title>0 and #title<=200,'Choose a task title up to 200 bytes')
 assert(type(description)=='string' and #description<=2000,'Task description exceeds 2000 bytes')
 assert(status=='not_started' or status=='in_progress' or status=='paused' or status=='blocked','Invalid task status')
end
function M.read(root,force,limit,completed)
 local board=root.facmandu_toby_tasks and root.facmandu_toby_tasks.forces[force.index] or {}
 local rows,total={},0
 for _,t in ipairs(board) do if completed or not t.completed then total=total+1;if #rows<limit then rows[#rows+1]=copy(t) end end end
 return {source='toby',force=force.name,tasks=rows,total=total,truncated=total>#rows}
end
function M.add(root,force,title,description,status)
 fields(title,description,status)
 root.facmandu_toby_tasks=root.facmandu_toby_tasks or {next=1,forces={}}
 local store=root.facmandu_toby_tasks;store.forces[force.index]=store.forces[force.index] or {}
 local board=store.forces[force.index]
 for _,t in ipairs(board) do if not t.completed and t.title==title and t.description==description then return {task=copy(t),created=false,source='toby'} end end
 assert(#board<500,'This force has 500 Toby tasks; reuse an existing task')
 local t={id=store.next,title=title,description=description,status=status,completed=false};store.next=store.next+1;board[#board+1]=t
 return {task=copy(t),created=true,source='toby'}
end
function M.update(root,force,id,expected,title,description,status,completed)
 fields(title,description,status);assert(type(completed)=='boolean','Choose a task completion state')
 local board=root.facmandu_toby_tasks and root.facmandu_toby_tasks.forces[force.index] or {}
 for _,t in ipairs(board) do if t.id==id then
  for _,key in ipairs{'title','description','status','completed'} do assert(t[key]==expected[key],'Task changed; read it again before editing') end
  t.title=title;t.description=description;t.status=status;t.completed=completed;return copy(t)
 end end
 error('Shared force task not found',0)
end
return M
