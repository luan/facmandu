import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import { blueprintArtifactSchema } from '../src/lib/blueprints';

test('sandbox adapter reads only owned existing labs and preserves native exports without player changes', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/integrations/blueprint-sandboxes.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player'};local enemy={name='enemy'}
 local player={name='Alice',index=1,force=force,controller_type=1}
 local surface={name='bpsb-lab-p-Alice',ignore_surface_conditions=true,daytime=0.95,freeze_daytime=true}
 local count=2;surface.find_entities_filtered=function(filter) assert(filter.force=='player');return count==2 and {{},{}} or {} end
 game={forces={player=force,enemy=enemy},surfaces={[surface.name]=surface},get_player=function(name) if name=='Alice' then return player end end}
 Lab={IsLab=function(s) return s==surface end};Isolation={IsFull=function() return false end}
 storage={players={[1]={forceName='player',labName=surface.name,sandboxForceName='bpsb-sb-f-player'}},labSurfaces={[surface.name]={forceName='player',sandboxForceName='bpsb-sb-f-player'}},sandboxForces={}}
 prototypes={entity={inserter={tile_width=1,tile_height=1}}}
 local destroys=0;local fail=false;local allocated=0
 local stack={cost_to_build={{name='inserter',count=1,quality='uncommon'}}}
 stack.set_stack=function(value) assert(value.name=='blueprint') end
 stack.create_blueprint=function(args) assert(args.surface==surface and args.force=='player' and args.include_modules);if fail then error('Native export failed') end end
 stack.get_blueprint_entities=function() return {{name='inserter',position={x=0.5,y=0.5},direction=0}} end
 stack.get_blueprint_tiles=function() return {} end
 stack.export_stack=function() return '0native-preserves-filters-wires-modules-quality' end
 game.create_inventory=function(n) allocated=allocated+1;assert(n==1);return {[1]=stack,destroy=function() destroys=destroys+1 end} end
 local api;remote={add_interface=function(name,value) assert(name=='facmandu-blueprint-sandboxes');api=value end}
 ${source}
 assert(#api.read('player','Alice').labs==1)
 assert(not pcall(api.read,'enemy','Alice'))
 assert(not pcall(api.read,'player','Unknown'))
 assert(not pcall(api.export,'player','Alice','force',0,0,16))
 assert(not pcall(api.export,'player','Alice','player',0,0,33))
 assert(allocated==0)
 local exported=api.export('player','Alice','player',0,0,16)
 assert(exported.blueprint=='0native-preserves-filters-wires-modules-quality')
 assert(exported.cost[1].quality=='uncommon' and exported.tiles==nil)
 assert(destroys==1 and player.controller_type==1 and player.force==force)
 fail=true;assert(not pcall(api.export,'player','Alice','player',0,0,16));assert(destroys==2)
 storage.labSurfaces[surface.name].forceName='enemy'
 assert(#api.read('player','Alice').labs==0)
 assert(not pcall(api.export,'player','Alice','player',0,0,16));assert(destroys==2)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('blueprint artifacts retain native quality-specific construction costs', () => {
	const artifact = blueprintArtifactSchema.parse({
		kind: 'blueprint',
		label: 'Sandbox',
		blueprint: '0native',
		entities: [
			{ name: 'inserter', position: { x: 0.5, y: 0.5 }, direction: 0, width: 1, height: 1 }
		],
		cost: [{ name: 'inserter', count: 1, quality: 'uncommon' }]
	});
	assert.deepEqual(artifact.cost, [{ name: 'inserter', count: 1, quality: 'uncommon' }]);
});

test('the public sandbox cannot opt into the headless runner warmup allowance', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/sandbox.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 storage={};defines={events={on_tick=1}}
 game={forces={player={name='player'}},surfaces={nauvis={name='nauvis'}}}
 require=function(name)
  if name=='events' then return {scope=function() return {on_event=function() end} end} end
  if name=='robot-trial' then return {} end
  error('Unexpected module')
 end
 local api;remote={add_interface=function(name,interface) api=interface end}
 local native=(function() ${source} end)()
 local args={force='player',surface='nauvis',seconds=120,warmupSeconds=120}
 local ok,message=pcall(api.start,args,120)
 assert(not ok and message:find('warmup 0..30',1,true),tostring(message))
 ok,message=pcall(native.start,args,120)
 assert(not ok and message:find('Invalid trial request key',1,true),tostring(message))
 ok,message=pcall(native.start,args,121)
 assert(not ok and message:find('Invalid fixture warmup limit',1,true),tostring(message))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
