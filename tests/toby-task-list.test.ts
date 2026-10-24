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
	const source = readFileSync('factorio-mod/facmandu-assistant/task-store.lua', 'utf8');
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

test('legacy task migration preserves identity and later native board edits', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/task-store.lua', 'utf8');
	const code = `local store=(function() ${source} end)()
 local force={name='player',index=1};local legacy={};local native={}
 local original=store.add(legacy,force,'Overflow','Protect stock','not_started').task
 local calls=0
 local remote={interfaces={['facmandu-toby-tasks']={read=true,add=true,update=true,import=true}},call=function(name,method,force_name,rows)
  assert(name=='facmandu-toby-tasks' and method=='import' and force_name=='player');calls=calls+1;return store.import(native,force,rows)
 end}
 store.migrate(legacy,force,remote)
 local task=store.read(native,force,20,true).tasks[1]
 assert(task.id==original.id and task.description==original.description)
 local edited=store.update(native,force,task.id,task,'Overflow','In game','in_progress',true)
 store.migrate(legacy,force,remote)
 assert(calls==1 and store.read(native,force,20,true).tasks[1].completed)
 local restored=store.update(native,force,edited.id,edited,'Overflow','In game','in_progress',false)
 assert(not restored.completed)
 assert(store.read(legacy,force,20,true).tasks[1].description=='Protect stock')`;
	const status = lauxlib.luaL_dostring(state, to_luastring(code));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('native Tasks controls edit, complete and reopen the shared board', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/task-store.lua', 'utf8');
	const board = readFileSync('factorio-mod/facmandu-assistant/task-board.lua', 'utf8');
	const code = `local handlers={};local api;local errors={}
 package.preload['task-store']=function() ${source} end
 package.preload['events']=function() return {scope=function() return {on_event=function(id,fn) handlers[id]=fn end} end} end
 defines={events={on_gui_click=1,on_gui_checked_state_changed=2,on_gui_selection_state_changed=3,on_gui_closed=4}}
 remote={add_interface=function(name,value) api=value end}
 helpers={table_to_json=function(t) local rows={};for _,r in ipairs(t.tasks) do rows[#rows+1]=r.title..r.description..r.status..tostring(r.completed) end;return table.concat(rows,'|') end}
 local function element(spec)
  local e={name='',valid=true,style={},children={},tags={}};for k,v in pairs(spec or {}) do if k~='style' then e[k]=v end end
  e.add=function(s) local child=element(s);e.children[#e.children+1]=child;if s.name then e[s.name]=child end;return child end
  e.clear=function() for _,child in ipairs(e.children) do child.valid=false end;e.children={} end
  e.destroy=function() e.valid=false end;e.focus=function() end;return e
 end
 local force={name='player',index=1};local other={name='other',index=2}
 local p={index=1,force=force,gui={screen=element()},print=function(text) errors[#errors+1]=text end}
 local q={index=2,force=force,gui={screen=element()},print=p.print}
 game={forces={player=force,other=other},get_player=function(i) return i==1 and p or q end}
 storage={gui={[1]={task_rows=element(),task_editor=element(),task_scroll=element(),task_title={text='New work'},content_width=400},[2]={task_rows=element(),task_editor=element(),task_scroll=element(),task_title={text=''},content_width=400}}}
 local module=(function() ${board} end)()
 local function find(parent,name) if parent.name==name then return parent end;for _,child in ipairs(parent.children) do local found=find(child,name);if found then return found end end end
 api.import('player',{{id=1,title='Overflow',description='Protect stock',status='not_started',completed=false}})
 local check=find(storage.gui[1].task_rows,'facmandu-toby-task-complete');check.state=true;handlers[2]{player_index=1,element=check}
 assert(api.read('player',20,true).tasks[1].completed and find(storage.gui[2].task_rows,'facmandu-toby-task-complete').state)
 check=find(storage.gui[1].task_rows,'facmandu-toby-task-complete');check.state=false;handlers[2]{player_index=1,element=check}
 assert(not api.read('player',20,true).tasks[1].completed)
 local status=find(storage.gui[1].task_rows,'facmandu-toby-task-status');status.selected_index=2;handlers[3]{player_index=1,element=status}
 assert(api.read('player',20,true).tasks[1].status=='in_progress')
 local edit=find(storage.gui[1].task_rows,'facmandu-toby-task-edit');handlers[1]{player_index=1,element=edit}
 local editor=storage.gui[1].task_editor['facmandu-toby-task-editor'];editor.title.text='Protect overflow';editor.description.text='Keep copper cable'
 handlers[1]{player_index=1,element=find(editor,'facmandu-toby-task-save')}
 assert(api.read('player',20,true).tasks[1].title=='Protect overflow')
 handlers[1]{player_index=1,element={valid=true,name='facmandu-toby-task-add',tags={}}}
 assert(api.read('player',20,true).total==2 and storage.gui[1].task_title.text=='')
 assert(api.read('other',20,true).total==0 and #errors==0,table.concat(errors,';'))`;
	const status = lauxlib.luaL_dostring(state, to_luastring(code));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
