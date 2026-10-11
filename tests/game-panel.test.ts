import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('Toby panel sends native player requests and preserves typed drafts across progress updates', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/control.lua', 'utf8');
	const script = `
 local handlers={};local interface;local last
 storage={};defines={events={on_player_created=1,on_player_joined_game=2,on_gui_click=3,on_gui_selection_state_changed=4,on_gui_closed=5,on_gui_text_changed=6}}
 script={on_init=function(fn) handlers.init=fn end,on_configuration_changed=function(fn) handlers.migrate=fn end,on_event=function(event,fn) handlers[event]=fn end}
 remote={add_interface=function(name,api) assert(name=='facmandu-assistant');interface=api end}
 helpers={table_to_json=function(data) last=data;return '{}' end};log=function() end
 local function gui(parent,name)
  local element={name=name or '',valid=true,style={}}
  element.add=function(spec)
   local child=gui(element,spec.name);for key,value in pairs(spec) do child[key]=value end
   if spec.name then element[spec.name]=child end
   return child
  end
  element.destroy=function() element.valid=false;if parent then parent[element.name]=nil end end
  return element
 end
 local cleared=false;local imported;local full=true
 local player={name='Alice',index=1,gui={top=gui(),screen=gui()},print=function() end,clear_cursor=function() cleared=true;return not full end,cursor_stack={import_stack=function(value) imported=value;return 0 end}}
 game={players={player},get_player=function(index) if index==1 then return player end end}
 ${source}
 handlers.init();assert(player.gui.top['facmandu-toby-open'])
 interface.update_player(1,{status='Ready',answer='First answer',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 interface.open_player(1)
 local frame=player.gui.screen['facmandu-toby-panel']
 assert(frame.caption=='Toby' and frame['facmandu-toby-chats'].selected_index==1)
 frame['facmandu-toby-message'].text='More glass'
 handlers[6]({player_index=1,element=frame['facmandu-toby-message']})
 handlers.migrate();frame=player.gui.screen['facmandu-toby-panel']
 assert(frame['facmandu-toby-message'].text=='More glass')
 interface.update_player(1,{status='Working',answer='First answer',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 assert(frame['facmandu-toby-message'].text=='More glass')
 handlers[3]({player_index=1,element={valid=true,name='facmandu-toby-send'}})
 assert(last.player=='Alice' and last.operation=='send' and last.prompt=='More glass' and last.chat=='one')
 assert(frame['facmandu-toby-message'].text=='')
 frame['facmandu-toby-chats'].selected_index=2
 handlers[4]({player_index=1,element=frame['facmandu-toby-chats']})
 assert(last.operation=='select' and last.chat=='two')
 handlers[3]({player_index=1,element={valid=true,name='facmandu-toby-stop'}})
 assert(last.operation=='stop' and last.chat=='two')
 assert(not pcall(interface.update_player,1,{status=string.rep('x',501),answer='',chats={}}))
 assert(not pcall(interface.update_player,1,{status='',answer='',chats={},blueprint='not a blueprint'}))
 interface.update_player(1,{status='Ready',answer='Design ready',current='one',chats={{id='one',title='Glass'}},blueprint='0abc='})
 assert(frame['facmandu-toby-blueprint'].enabled)
 handlers[3]({player_index=1,element={valid=true,name='facmandu-toby-blueprint'}})
 assert(cleared and not imported and frame.valid)
 full=false
 handlers[3]({player_index=1,element={valid=true,name='facmandu-toby-blueprint'}})
 assert(imported=='0abc=' and not frame.valid)
 interface.open_player(1);frame=player.gui.screen['facmandu-toby-panel']
 handlers[5]({element=frame});assert(not frame.valid)
 `;
	const status = lauxlib.luaL_dostring(state, to_luastring(script));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
