-- TaskList owns all task operations; old Toby records are migration sources only.
local M={}
 function M.interface(remote)
  local api=remote and remote.interfaces['facmandu-task-list']
  if api and api.read and api.add and api.update then return 'facmandu-task-list' end
  return nil
 end
 function M.migrate(root,force,remote)
  local legacy=root.facmandu_toby_tasks
  if M.interface(remote)=='facmandu-task-list' and remote.interfaces['facmandu-task-list'].import then
   if remote.interfaces['facmandu-toby-tasks'] then
    local board=remote.call('facmandu-toby-tasks','read',force.name,50,true)
    assert(not board.truncated,'Toby task migration exceeds 50 tasks; keep both boards until paged migration is available')
    remote.call('facmandu-task-list','import',force.name,'toby',board.tasks)
   end
   if legacy and legacy.forces[force.index] and not (legacy.migrated and legacy.migrated[force.index]) then
    remote.call('facmandu-task-list','import',force.name,'scenario',legacy.forces[force.index])
   end
   return
  end
  error('TaskList is required for shared tasks; enable the public TaskList mod',0)
 end
 return M
