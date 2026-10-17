import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('compact planner recovers orphaned windows and survives repeated display changes', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const compact = readFileSync(
		'factorio-mod/facmandu-assistant/planner/ui/base/compact_dialog.lua',
		'utf8'
	);
	const gui = readFileSync('factorio-mod/facmandu-assistant/planner/util/gui.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local function element(parent, spec)
  local result={valid=true,visible=true,style={},tags={},children={},children_names={}}
  for key,value in pairs(spec or {}) do if key~='style' then result[key]=value end end
  result.add=function(child_spec)
   assert(not child_spec.name or not result[child_spec.name], 'Duplicate GUI element')
   local child=element(result,child_spec)
   result.children[#result.children+1]=child
   if child.name then result[child.name]=child end
   return child
  end
  result.destroy=function()
   result.valid=false
   if parent then
    if result.name then parent[result.name]=nil end
    for index,child in ipairs(parent.children) do
     if child==result then table.remove(parent.children,index);break end
    end
   end
  end
  return result
 end
 local screen=element();local buttons=element()
 package.preload['mod-gui']=function() return {get_button_flow=function() return buttons end} end
 local ui={compact_elements={}}
 lib={actions={},globals={ui_state=function() return ui end,preferences=function() return {compact_width_percentage=25} end}}
 lib.gui=(function() ${gui} end)()
 lib.gui.run_build=function() end
 lib.gui.calculate_scaled_resolution=function(player) return player.display_resolution end
 item_views={rebuild_data=function() end,rebuild_interface=function() end}
 local player={gui={screen=screen},display_resolution={width=1920,height=1080},display_scale=1}
 local listeners=(function() ${compact} end)()[2].player
 local name='toby_planner_frame_compact_dialog'
 local orphan=screen.add{type='frame',name=name,visible=true}
 ui.compact_elements={stale_reference=true}
 listeners.on_player_display_resolution_changed(player,{})
 assert(not orphan.valid and screen[name].visible)
 assert(not ui.compact_elements.stale_reference)
 assert(screen[name].tags.mod=='toby-planner')
 for index=1,4 do
  local old=screen[name]
  old.visible=index%2==0
  ui.compact_elements={}
  listeners.on_player_display_scale_changed(player,{})
  assert(not old.valid and screen[name].visible==(index%2==0))
  assert(#screen.children==1)
 end
 local unrelated=screen.add{type='frame',name='other_mod_frame',tags={mod='other'}}
 local current=screen[name]
 lib.gui.reset_player(player)
 assert(not current.valid and unrelated.valid and not screen[name])
 -- Old saves contain an untagged compact root even after references are reset.
 local legacy=screen.add{type='frame',name=name}
 ui.compact_elements={}
 lib.gui.reset_player(player)
 assert(not legacy.valid and unrelated.valid)
 listeners.on_player_display_resolution_changed(player,{})
 assert(not screen[name].visible and #screen.children==2)
 assert(ui.compact_elements.compact_frame==screen[name])
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});

test('empty planning blocks remain navigable through nested floors', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const sources = ['Object', 'Planning', 'Floor']
		.map(
			(name) =>
				`package.preload['planner.backend.data.${name}']=function() ${readFileSync(`factorio-mod/facmandu-assistant/planner/backend/data/${name}.lua`, 'utf8')} end`
		)
		.join('\n');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 script={register_metatable=function() end}
 storage={planner={next_object_ID=1}}
 package.preload['planner.backend.data.Line']=function() return {} end
 package.preload['planner.backend.data.SimpleItem']=function() return {} end
 ${sources}
 local Floor=require('planner.backend.data.Floor')
 local outer=Floor.init(2,'simplex')
 local empty=Floor.init(3,'simplex')
 outer:insert(empty)
 assert(not outer:get_defining_line() and not empty:get_defining_line())
 assert(not outer:get_status() and not empty:get_status())
 assert(not outer:check_product_compatibility(empty))
 empty.solver_error='no_solution'
 assert(empty:get_status()=='solver_error' and outer:get_status()=='solver_error')
 outer:remove(empty,true)
 assert(not outer:get_status() and not outer:get_defining_line())
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});
