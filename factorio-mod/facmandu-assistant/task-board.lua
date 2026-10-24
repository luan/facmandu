-- Read-only compatibility export for migrating old Toby tasks into TaskList.
-- No UI or task mutations remain here; TaskList is the only task system.
local store=require('task-store')
remote.add_interface('facmandu-toby-tasks',{
 read=function(name,limit,completed)
  local force=assert(game.forces[name],'Force no longer exists')
  local result=store.read(storage,force,math.max(1,math.min(50,limit or 20)),completed)
  result.visible=false;result.window='Legacy archive for TaskList migration';return result
 end
})
return {}
