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
 api.import('player','toby',{{id=1,title='Imported',description='Original',status='paused',completed=false}})
 local imported=api.read('player',20,false).tasks[1]
 assert(imported.title=='Imported' and imported.id~=1)
 local edited=api.update('player',imported.id,imported,'Imported','Player edit','blocked',false)
 api.import('player','toby',{{id=1,title='Imported',description='Original',status='paused',completed=false}})
 assert(api.read('player',20,false).total==1 and api.read('player',20,false).tasks[1].description=='Player edit')
 assert(api.read('player',20,true).source=='TaskList' and api.read('player',20,true).visible)
 assert(not pcall(api.import,'player','toby',{{id=9,title='Private',description='',status='invented',completed=false}}))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('connected tasks require TaskList and migrate the native board without stale scenario duplicates', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const service = readFileSync(
		'src/lib/server/factory-query/scripts/tools/task_service.lua',
		'utf8'
	);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local tasks=(function() ${service} end)()
 local force={index=1,name='player'};local calls={}
 local remote={interfaces={['facmandu-task-list']={read=true,add=true,update=true,import=true},['facmandu-toby-tasks']={read=true,add=true,update=true}},call=function(name,method,...)
  local args={...};calls[#calls+1]={name,method,args}
  if name=='facmandu-toby-tasks' then return {tasks={{id=7,title='Edited in game'}},truncated=false} end
  assert(method=='import' and args[1]=='player' and args[2]=='toby' and args[3][1].id==7)
  return {imported=true}
 end}
 assert(tasks.interface(remote)=='facmandu-task-list')
 tasks.migrate({facmandu_toby_tasks={forces={[1]={{id=7,title='Stale'}}},migrated={[1]=true}}},force,remote)
 assert(#calls==2 and calls[1][2]=='read' and calls[2][2]=='import')
 remote.interfaces['facmandu-task-list']=nil
 assert(tasks.interface(remote)==nil)
 assert(not pcall(tasks.migrate,{},force,remote))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('TaskList console bootstrap reconnects after reload without replacing existing interfaces', async () => {
	const { taskListBridgeCommand } = await import('../src/lib/server/task-list-bridge');
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	assert.ok(taskListBridgeCommand.startsWith('/silent-command __TaskList__ '));
	const command = taskListBridgeCommand.slice('/silent-command __TaskList__ '.length);
	const code = `local calls=0;local reply
 script={mod_name='TaskList',active_mods={TaskList='0.6.0'}}
 package.preload['scripts.task']=function()return {}end
 remote={interfaces={},add_interface=function(name,api)calls=calls+1;remote.interfaces[name]=api end}
 helpers={table_to_json=function(row)reply=row;return 'ok'end};rcon={print=function()end}
 ${command}
 assert(reply.ready and calls==1 and remote.interfaces['facmandu-task-list'].import)
 local original=remote.interfaces['facmandu-task-list']
 ${command}
 assert(reply.ready and calls==1 and original==remote.interfaces['facmandu-task-list'])
 remote.interfaces={}
 ${command}
 assert(reply.ready and calls==2)
 script.active_mods.TaskList='0.7.0';remote.interfaces={}
 ${command}
 assert(reply.error and calls==2)
 `;
	const status = lauxlib.luaL_dostring(state, to_luastring(code));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('task actions cannot write to an alternate store without TaskList', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const service = readFileSync(
		'src/lib/server/factory-query/scripts/tools/task_service.lua',
		'utf8'
	);
	const actions = readFileSync('src/lib/server/factory-actions/action.lua', 'utf8');
	const code = `local toby_tasks=(function() ${service} end)()
 storage={facmandu_toby_tasks={next=9,forces={}}};game={forces={player={name='player',index=1}}};remote={interfaces={}}
 ${actions}
 assert(not pcall(action,{operation='task_add',force='player',title='New task',description='',status='not_started'}))
 assert(storage.facmandu_toby_tasks.next==9 and next(storage.facmandu_toby_tasks.forces)==nil)
 `;
	const status = lauxlib.luaL_dostring(state, to_luastring(code));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
