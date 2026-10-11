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
 storage={};defines={events={on_player_created=1,on_player_joined_game=2,on_gui_click=3,on_gui_selection_state_changed=4,on_gui_closed=5,on_gui_text_changed=6,on_gui_selected_tab_changed=7,on_gui_confirmed=8}}
 script={on_init=function(fn) handlers.init=fn end,on_configuration_changed=function(fn) handlers.migrate=fn end,on_event=function(event,fn) handlers[event]=fn end}
 remote={add_interface=function(name,api) assert(name=='facmandu-assistant');interface=api end}
 helpers={table_to_json=function(data) last=data;return '{}' end};log=function() end
 local function gui(parent,name)
  local element={name=name or '',valid=true,style={},children={}}
  element.add=function(spec)
   local child=gui(element,spec.name);element.children[#element.children+1]=child;for key,value in pairs(spec) do if key~="style" then child[key]=value end end
   if spec.name then element[spec.name]=child end
   return child
  end
  element.add_tab=function() end
  element.focus=function() end
  element.clear=function() element.children={} end
  element.scroll_to_bottom=function() end
  element.destroy=function() element.valid=false;if parent then parent[element.name]=nil end end
  return element
 end
 local cleared=false;local imported;local full=true
 local player={name='Alice',index=1,display_resolution={height=1080},display_scale=1,surface={name='nauvis'},gui={top=gui(),screen=gui()},print=function() end,clear_cursor=function() cleared=true;return not full end,cursor_stack={import_stack=function(value) imported=value;return 0 end}}
 game={players={player},get_player=function(index) if index==1 then return player end end}
 ${source}
 handlers.init();assert(player.gui.top['facmandu-toby-open'])
 interface.update_player(1,{status='Ready',answer='First answer',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 interface.open_player(1)
 local frame=player.gui.screen['facmandu-toby-panel']
 local refs=storage.gui[1]
 assert(refs.chats.selected_index==1 and refs.frame.location.x==16)
 storage.gui[1].message.text='More glass'
 handlers[6]({player_index=1,element=storage.gui[1].message})
 handlers.migrate();frame=player.gui.screen['facmandu-toby-panel']
 assert(storage.gui[1].message.text=='More glass')
 interface.update_player(1,{status='Working',running=true,answer='First answer',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 assert(storage.gui[1].message.text=='More glass')
 assert(storage.gui[1].send.caption=='Steer' and storage.gui[1].stop.visible)
 handlers[8]({player_index=1,element=storage.gui[1].message})
 assert(last.player=='Alice' and last.operation=='send' and last.prompt=='More glass' and last.chat=='one')
 assert(storage.gui[1].message.text=='')
 storage.gui[1].chats.selected_index=2
 handlers[4]({player_index=1,element=storage.gui[1].chats})
 assert(last.operation=='select' and last.chat=='two')
 handlers[3]({player_index=1,element={valid=true,name='facmandu-toby-stop'}})
 assert(last.operation=='stop' and last.chat=='two')
 storage.gui[1].tabs.selected_tab_index=3
 handlers[7]({player_index=1,element=storage.gui[1].tabs})
 handlers['facmandu-toby-toggle']({player_index=1})
 handlers['facmandu-toby-toggle']({player_index=1});frame=player.gui.screen['facmandu-toby-panel']
 assert(storage.gui[1].tabs.selected_tab_index==3)
 assert(not pcall(interface.update_player,1,{status=string.rep('x',501),answer='',chats={}}))
 assert(not pcall(interface.update_player,1,{status='',answer='',chats={},blueprint='not a blueprint'}))
 assert(not pcall(interface.update_player,1,{status='',answer='',chats={},messages={{role='unknown',text='hidden'}}}))
 interface.update_player(1,{status='Ready',answer='Design ready',current='one',chats={{id='one',title='Glass'}},blueprint='0abc='})
 assert(#storage.gui[1].design.children==3)
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
