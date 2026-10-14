import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('Toby panel sends native player requests and preserves typed drafts across progress updates', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const references = readFileSync('factorio-mod/facmandu-assistant/references.lua', 'utf8');
	const source = readFileSync('factorio-mod/facmandu-assistant/control.lua', 'utf8');
	const events = readFileSync('factorio-mod/facmandu-assistant/events.lua', 'utf8');
	const books = readFileSync('factorio-mod/facmandu-assistant/planner/books.lua', 'utf8');
	const script = `
 package.preload.events=function() ${events} end
 package.preload['planner.control']=function() end
 package.preload['planner.api']=function() end
 package.preload.sandbox=function() end
 package.preload['planner.books']=function() ${books} end
 package.preload.references=function() ${references} end
 prototypes={item={},fluid={},recipe={},entity={},technology={}}
 local handlers={};local interface;local last
 package.preload.drone=function() return {init=function() end,built=function() end,tick=function() end,animate=function() end,read=function() return {available=false} end} end
 storage={};defines={events={on_player_created=1,on_player_joined_game=2,on_gui_click=3,on_gui_selection_state_changed=4,on_gui_closed=5,on_gui_text_changed=6,on_gui_selected_tab_changed=7,on_gui_confirmed=8,on_built_entity=9,on_lua_shortcut=10,on_player_changed_force=11,on_forces_merged=12,on_player_display_resolution_changed=13,on_player_display_scale_changed=14}}
 script={on_init=function(fn) handlers.init=fn end,on_configuration_changed=function(fn) handlers.migrate=fn end,on_event=function(event,fn) handlers[event]=fn end,on_nth_tick=function() end}
 remote={add_interface=function(name,api) assert(name=='facmandu-assistant');interface=api end,
 call=function(name,operation,force,player,id) assert(name=='facmandu-toby-planner' and operation=='read_plan' and force=='player' and player=='Alice' and id==99);return {reference='toby://plan/1/99'} end}
 local function encode(data)
  if type(data)~='table' then return tostring(data) end
  local parts={};for key,value in pairs(data) do parts[#parts+1]=tostring(key)..'='..encode(value) end
  table.sort(parts);return table.concat(parts,'|')
 end
 helpers={table_to_json=function(data) if data.operation then last=data end;return encode(data) end};log=function() end
 local function gui(parent,name)
  local element={type='flow',parent=parent,tags={},name=name or '',valid=true,visible=true,style={},children={}}
  element.add=function(spec)
   local child=gui(element,spec.name);element.children[#element.children+1]=child;for key,value in pairs(spec) do if key~="style" then child[key]=value end end
   if spec.name then element[spec.name]=child end
   return child
  end
  element.add_tab=function() end
  element.focus=function() end
  element.clear=function() element.children={} end
  element.scroll_to_bottom=function() end
  element.destroy=function() element.valid=false;if parent then parent[element.name]=nil;for i,child in ipairs(parent.children) do if child==element then table.remove(parent.children,i);break end end end end
  return element
 end
 local cleared=false;local imported;local full=true
 local player={name='Alice',index=1,force={name='player',index=1},display_resolution={height=1080,width=1920},display_scale=1,surface={name='nauvis'},gui={top=gui(),screen=gui()},print=function() end,clear_cursor=function() cleared=true;return not full end,cursor_stack={import_stack=function(value) imported=value;return 0 end}}
 game={players={player},get_player=function(index) if index==1 then return player end end}
 ${source}
 handlers.init();assert(player.gui.top['facmandu-toby-open'])
 interface.update_player(1,{status='Ready',answer='First answer',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 interface.open_player(1)
 local frame=player.gui.screen['facmandu-toby-panel']
 local refs=storage.gui[1]
 assert(refs.chats.selected_index==1 and refs.frame.location.x==16)
 local function find(element,name)
  if element.name==name then return element end
  for _,child in ipairs(element.children) do local found=find(child,name);if found then return found end end
 end
 assert(find(frame,'facmandu-toby-new').tooltip=='New conversation · Other tasks keep working')
 assert(not find(frame,'facmandu-toby-planning'),'Chat must have its own entry point')
 local message=refs.message
 local native_text=message.text
 local typing=false
 rawset(message,'text',nil)
 setmetatable(message,{__index=function(_,key) if key=='text' then return native_text end end,
  __newindex=function(element,key,value)
   if key=='text' then assert(not typing,'Typing must not write text back to the native field');native_text=value
   else rawset(element,key,value) end
  end})
 for _,text in ipairs{'i','i need','i need you to design','i need you to design a glass line'} do
  native_text=text;typing=true
  handlers[6]({player_index=1,element=message})
  typing=false
  assert(message.text==text and storage.drafts[1]==text)
 end
 native_text=string.rep('a',5999)..'é'
 handlers[6]({player_index=1,element=message})
 assert(#message.text==5999,'The input bound must preserve complete UTF-8 characters')

 storage.gui[1].message.text='More glass'
 handlers[6]({player_index=1,element=storage.gui[1].message})
 handlers.migrate();frame=player.gui.screen['facmandu-toby-panel']
 assert(storage.gui[1].message.text=='More glass')
 interface.update_player(1,{status='Working',running=true,answer='First answer',current='one',chats={{id='one',title='Glass',state='running',status='Connecting belts',author='Alice'},{id='two',title='Science',state='done',status='Blueprint ready'}}})
 assert(storage.gui[1].message.text=='More glass')
 assert(storage.gui[1].send.caption=='Steer' and storage.gui[1].stop.visible)
 assert(storage.gui[1].heading.caption=='Glass' and storage.gui[1].status.caption=='Working')
 handlers[3]({player_index=1,element=storage.gui[1].tasks.children[2].children[1]})
 assert(last.operation=='select' and last.chat=='two')
 interface.update_player(1,{status='Ready',answer='',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}},messages={{role='user',author='Bob',text='Bob: Build glass'}}})
 assert(storage.gui[1].conversation.children[1].children[1].caption=='Bob')
 assert(storage.gui[1].conversation.children[1].children[2].caption=='Build glass')
 handlers[3]({player_index=1,element=find(frame,'facmandu-toby-new')})
 assert(last.operation=='new' and last.player=='Alice')
 assert(storage.gui[1].message.text=='More glass')
 interface.update_player(1,{status='Ready',answer='',current='two',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 assert(storage.gui[1].message.text=='')
 storage.gui[1].message.text='Science draft';handlers[6]({player_index=1,element=storage.gui[1].message})
 interface.update_player(1,{status='Ready',answer='',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 assert(storage.gui[1].message.text=='More glass')
 storage.gui[1].frame.visible=false
 interface.update_player(1,{status='Ready',answer='',current='two',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 interface.open_player(1)
 assert(storage.gui[1].message.text=='Science draft')
 handlers[13]({player_index=1});frame=player.gui.screen['facmandu-toby-panel']
 assert(storage.gui[1].message.text=='Science draft')
 interface.update_player(1,{status='Ready',answer='',current='one',chats={{id='one',title='Glass'},{id='two',title='Science'}}})
 handlers[8]({player_index=1,element=storage.gui[1].message})
 assert(last.player=='Alice' and last.operation=='send' and last.prompt=='More glass' and last.chat=='one')
 assert(storage.gui[1].message.text=='')
 storage.gui[1].chats.selected_index=2
 handlers[4]({player_index=1,element=storage.gui[1].chats})
 assert(last.operation=='select' and last.chat=='two')
 handlers[3]({player_index=1,element={valid=true,name='facmandu-toby-stop'}})
 assert(last.operation=='stop' and last.chat=='one')
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
 handlers[8]({player_index=1,element=storage.gui[1].message,control=true,shift=true})
 assert(player.opened==player.cursor_stack and not frame.valid)
 interface.open_player(1);frame=player.gui.screen['facmandu-toby-panel']
 handlers[5]({element=frame});assert(not frame.valid)
 handlers['facmandu-toby-open-drone']({player_index=1})
 assert(storage.gui[1].tabs.selected_tab_index==4)
 storage.gui[1].message.text='Build my plan';storage.drafts[1]='Build my plan'
 assert(interface.attach_plan(1,99)=='toby://plan/1/99')
 assert(storage.gui[1].message.text=='Build my plan\\nPlan: toby://plan/1/99')
 assert(storage.drafts[1]==storage.gui[1].message.text)
 player.display_resolution.width=600
 handlers[13]({player_index=1})
 assert(storage.gui[1].frame.style.width==520 and storage.gui[1].content_width>270)
 assert(storage.gui[1].message.text=='Build my plan\\nPlan: toby://plan/1/99')
 assert(storage.books[1][1].id=='one' and storage.books[1][1].blueprint=='0abc=')
 local artifacts={{id=string.rep('a',64),chatId='one',title='Glass',label='Furnaces',blueprint='0def='},{id=string.rep('b',64),chatId='one',title='Glass',label='Belts',blueprint='0ghi='}}
 local packet={force='player',status='Ready',answer='',current='one',chats={{id='one',title='Glass'}},blueprints=artifacts}
 storage.gui[1].frame.visible=false
 local receipt=interface.update_player(1,packet)
 assert(#receipt.blueprints==2 and receipt.blueprints[1]==artifacts[1].id)
 assert(#interface.update_player(1,packet).blueprints==2)
 artifacts[1].blueprint='0changed='
 assert(#interface.update_player(1,packet).blueprints==1)
 packet.force='enemy';assert(not pcall(interface.update_player,1,packet));packet.force='player'
 for i=1,29 do
  packet.blueprints={{id=string.format('%064x',i),chatId='one',title='Glass',label='Design '..i,blueprint='0abc='}}
  assert(#interface.update_player(1,packet).blueprints==1)
 end
 packet.blueprints={{id=string.rep('c',64),chatId='one',title='Glass',label='Beyond capacity',blueprint='0abc='}}
 assert(#interface.update_player(1,packet).blueprints==0)
 assert(#interface.update_player(1,packet).blueprints==0)
 handlers[11]({player_index=1})
 assert(not storage.players[1] and not storage.gui[1].frame.valid)
 handlers['facmandu-toby-toggle']({player_index=1});handlers['facmandu-toby-toggle']({player_index=1})
 assert(storage.gui[1].tabs.selected_tab_index==4)
 `;
	const status = lauxlib.luaL_dostring(state, to_luastring(script));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('planner and chat advertise independent defaults with the familiar planner keys', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const hotkeys = readFileSync(
		'factorio-mod/facmandu-assistant/planner/prototypes/hotkeys.lua',
		'utf8'
	);
	const shortcuts = readFileSync(
		'factorio-mod/facmandu-assistant/planner/prototypes/shortcuts.lua',
		'utf8'
	);
	const data = readFileSync('factorio-mod/facmandu-assistant/data.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local entries={}
 data={extend=function(_,rows) for _,row in ipairs(rows) do assert(not entries[row.name]);entries[row.name]=row end end}
 package.preload['planner.data']=function() end
 package.preload['drone-prototypes']=function() end
 ${hotkeys}
 ${shortcuts}
 ${data}
 assert(entries.toby_planner_toggle_interface.key_sequence=='CONTROL + R')
 assert(entries.toby_planner_toggle_interface.alternative_key_sequence=='U')
 assert(entries.toby_planner_toggle_compact_view.key_sequence=='CONTROL + SHIFT + R')
 assert(entries.toby_planner_toggle_calculator.key_sequence=='CONTROL + SHIFT + C')
 assert(entries['facmandu-toby-toggle'].key_sequence=='CONTROL + SHIFT + T')
 assert(entries['facmandu-toby-open'].associated_control_input=='facmandu-toby-toggle')
 assert(entries.toby_planner_open_interface.associated_control_input=='toby_planner_toggle_interface')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
