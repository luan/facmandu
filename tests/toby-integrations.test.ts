import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

for (const external of [false, true]) {
	test(`native planner retains legacy integrations with external planner ${external}`, () => {
		const state = lauxlib.luaL_newstate();
		lualib.luaL_openlibs(state);
		const source = readFileSync(
			'factorio-mod/facmandu-assistant/planner/backend/handlers/integrator.lua',
			'utf8'
		);
		const status = lauxlib.luaL_dostring(
			state,
			to_luastring(`
 storage={planner={integrations={},installed_mods={},version='2.1.18'}}
 script={active_mods={['facmandu-assistant']='0.0.7',legacy_provider='1.0',factoryplanner=${external ? "'2.1.18'" : 'nil'}}}
 game={forces={{index=1}},players={},tick=0}
 lib={effects={blank={speed=0,productivity=0}}};MAGIC_NUMBERS={effect_precision=10000}
 prototypes={recipe={['plate-recycling']={name='plate-recycling',hidden=true,products={},ingredients={}}}}
 local speed=.25
 local original=function() error('External planner invalidation must not be replaced') end
 remote={interfaces={['fp-integration-legacy_provider']={machine_effects=function() return {version=1,effects={furnace={speed=speed}}} end}}}
 if script.active_mods.factoryplanner then remote.interfaces['fp-integration']={invalidate=original} end
 remote.add_interface=function(name,api) assert(not remote.interfaces[name]);remote.interfaces[name]=api end
 remote.call=function(name,method,...) return remote.interfaces[name][method](...) end
 ${source}
 integrator.initialize();integrator.collect('recycling_recipes')
 assert(storage.planner.integrations.machine_effects[1].furnace.speed==2500)
 assert(storage.planner.integrations.recycling_recipes['plate-recycling'])
 if script.active_mods.factoryplanner then assert(remote.interfaces['fp-integration'].invalidate==original)
 else
  speed=.5
  remote.call('fp-integration','invalidate',{version=1,integration='machine_effects'})
  assert(storage.planner.integrations.machine_effects[1].furnace.speed==5000)
 end
 `)
		);
		assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	});
}
