import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('native fuel preferences survive expanded burner categories and fall back when removed', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync(
		'factorio-mod/facmandu-assistant/planner/backend/handlers/defaults.lua',
		'utf8'
	);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local dream={name='dream',combined_category='chemical-dream'}
 local coal={name='coal',combined_category='chemical-dream'}
 storage={planner={prototypes={fuels={{id=1,name='chemical-dream',members={dream,coal}}}}}}
 prototyper={data_types={fuels=true},util={find=function(kind,name,category)
  assert(kind=='fuels' and category=='chemical-dream')
  return name=='coal' and coal or name=='dream' and dream or nil
 end}}
 ${source}
 local player={preferences={default_prototypes={fuels={{proto={name='coal',combined_category='chemical'}}}}}}
 defaults.migrate(player)
 assert(player.preferences.default_prototypes.fuels[1].proto==coal)
 player.preferences.default_prototypes.fuels={{proto={name='removed-fuel',combined_category='chemical'}}}
 defaults.migrate(player)
 assert(player.preferences.default_prototypes.fuels[1].proto==dream)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
