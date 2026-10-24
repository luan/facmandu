-- Read-only archive of old Toby tasks for migration into TaskList.
local M={}
local function copy(t) return {id=t.id,title=t.title,description=t.description,status=t.status,completed=t.completed} end
function M.read(root,force,limit,completed)
 local board=root.facmandu_toby_tasks and root.facmandu_toby_tasks.forces[force.index] or {}
 local rows,total={},0
 for _,t in ipairs(board) do if completed or not t.completed then total=total+1;if #rows<limit then rows[#rows+1]=copy(t) end end end
 return {source='toby',force=force.name,tasks=rows,total=total,truncated=total>#rows}
end
return M
