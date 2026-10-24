import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('Task List adapter scopes shared tasks, reuses additions and rejects concurrent edits', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/integrations/task-list.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',index=1,object_name='LuaForce'}
 local other={name='enemy',index=2,object_name='LuaForce'}
 local private={name='Alice',object_name='LuaPlayer'}
 game={forces={player=force,enemy=other}}
 storage={forces={[1]={},[2]={}},tasks={},next_task_id=1}
 helpers={table_to_json=function(row) return row.title..row.description end}
 local api
 remote={add_interface=function(name,interface) assert(name=='facmandu-task-list');api=interface end}
 package.preload['scripts.task']=function()
  return {new=function(title,description,owner,assignee,status)
   local id=storage.next_task_id;storage.next_task_id=id+1
   local task={id=id,title=title,description=description,owner=owner,assignee=assignee,status=status,completed=false}
   function task:update(t,d,a,s) self.title=t;self.description=d;self.assignee=a;self.status=s end
   function task:toggle_completed() self.completed=not self.completed end
   storage.tasks[id]=task;return task
  end}
 end
 ${source}
 local created=api.add('player','Glass','Mine → sand → glass → bus','not_started')
 assert(created.created and created.task.id==1)
 assert(not api.add('player','Glass','Mine → sand → glass → bus','not_started').created)
 api.add('enemy','Enemy plans','Private force','not_started')
 require('scripts.task').new('Personal','Private player',private,nil,'not_started')
 local board=api.read('player',20,false)
 assert(board.total==1 and board.tasks[1].id==1)
 local expected=board.tasks[1]
 local updated=api.update('player',1,expected,'Glass','Ghosts placed','in_progress',false)
 assert(updated.status=='in_progress' and updated.description=='Ghosts placed')
 assert(not pcall(api.update,'player',1,expected,'Overwrite','Stale','not_started',false))
 assert(not pcall(api.update,'enemy',1,updated,'Foreign','Denied','not_started',false))
 assert(not pcall(api.update,'player',3,updated,'Private','Denied','not_started',false))
 assert(not pcall(api.add,'player',string.rep('x',201),'','not_started'))
 assert(not pcall(api.add,'player','Invalid','','invented'))
 local done=api.update('player',1,updated,'Glass','Ghosts placed','in_progress',true)
 assert(done.completed and api.read('player',20,false).total==0)
 assert(api.read('player',20,true).total==1)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('Toby shared tasks persist in the save without TaskList and reject stale or foreign edits', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync(
		'src/lib/server/factory-query/scripts/tools/shared_tasks.lua',
		'utf8'
	);
	const actions = readFileSync('src/lib/server/factory-actions/action.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 storage={};local player={index=1,name='player'};local enemy={index=2,name='enemy'}
 game={forces={player=player,enemy=enemy}};remote={interfaces={}}
 local toby_tasks=(function() ${source} end)()
 ${actions}
 assert(toby_tasks.read(storage,player,20,false).total==0 and next(storage)==nil)
 local added=action{operation='task_add',force='player',title='Scrap',description='900/min',status='not_started'}
 assert(added.created and added.source=='toby')
 assert(not action{operation='task_add',force='player',title='Scrap',description='900/min',status='not_started'}.created)
 local before=added.task
 local updated=action{operation='task_update',force='player',id=before.id,expected=before,title='Scrap',description='Built',status='in_progress',completed=false}
 assert(updated.task.description=='Built' and before.description=='900/min')
 assert(not pcall(action,{operation='task_update',force='player',id=before.id,expected=before,title='Stale',description='',status='paused',completed=false}))
 assert(not pcall(action,{operation='task_update',force='enemy',id=before.id,expected=updated.task,title='Foreign',description='',status='paused',completed=false}))
 assert(toby_tasks.read(storage,enemy,20,true).total==0)
 local reloaded=(function() ${source} end)()
 assert(reloaded.read(storage,player,20,false).tasks[1].description=='Built')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
