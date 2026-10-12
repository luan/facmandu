import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('Toby owns a separate drone, rejects foreign/stale commands and preserves cargo on departure', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/drone.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 storage={};defines={inventory={spider_trunk=1}};local api
 local force={name='player',technologies={},recipes={},is_chunk_charted=function(_,chunk) return chunk[1]>=0 end}
 local surface={name='nauvis',find_entities_filtered=function() return {} end}
 local alice={name='alice',index=1,force=force,connected=true,character={},physical_surface=surface,physical_position={x=0,y=0},get_main_inventory=function() return nil end}
 local bob={name='bob',index=2,force=force,connected=true,character={},physical_surface=surface,physical_position={x=0,y=0},get_main_inventory=function() return nil end}
 game={players={},forces={force},get_player=function(id) if id==1 or id=='alice' then return alice elseif id==2 or id=='bob' then return bob end end}
 remote={add_interface=function(name,interface) assert(name=='facmandu-toby-drone');api=interface end}
 local inventory={get_contents=function() return {{name='transport-belt',quality='normal',count=10}} end}
 local entity={stop_spider=function() end,valid=true,name='toby-drone',force=force,unit_number=4,surface=surface,position={x=0,y=0},grid={available_in_batteries=1000},get_inventory=function() return inventory end}
 local module=(function() ${source} end)()
 module.init();module.built{entity=entity,player_index=1}
 local snapshot=api.read('player','alice')
 assert(snapshot.available and snapshot.unitNumber==4 and snapshot.cargo[1].count==10)
 assert(not api.read('player','bob').available)
 assert(not pcall(module.bind,bob,entity))
 assert(not pcall(api.read,'enemy','alice'))
 local next=api.command('player','alice','follow',snapshot)
 assert(next.mode=='follow' and entity.follow_target==alice.character)
 assert(not pcall(api.command,'player','alice','stay',snapshot))
 assert(not pcall(api.command,'player','bob','stay',next))
 assert(not pcall(api.command,'player','alice','move',next,{x=257,y=0}))
 assert(not pcall(api.command,'player','alice','move',next,{x=-2,y=0}))
 assert(not pcall(api.command,'player','alice','move',next,{x=0/0,y=0}))
 assert(entity.follow_target==alice.character and api.read('player','alice').revision==next.revision)
 next=api.command('player','alice','move',next,{x=25,y=2})
 assert(next.mode=='move' and entity.autopilot_destination.x==25 and not entity.follow_target)
 alice.connected=false;module.tick()
 local stopped=api.read('player','alice')
 assert(stopped.mode=='move' and not entity.follow_target and not entity.autopilot_destination)
 assert(stopped.cargo[1].count==10)
 assert(not pcall(api.command,'player','alice','follow',stopped))
 alice.connected=true;alice.physical_surface={name='platform-1'}
 assert(not pcall(api.command,'player','alice','follow',stopped))
 alice.physical_surface=surface
 api.command('player','alice','follow',stopped)
 alice.character={};module.tick();assert(entity.follow_target==alice.character)
 entity.valid=false;module.tick();assert(not api.read('player','alice').available)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('automatic Toby constructs without equipment and conserves real materials on failed revival', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/drone.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 storage={};defines={inventory={spider_trunk=1,chest=2}};local api
 local function stack(count)
  local data={count=count,name='transport-belt',quality={name='normal'}}
  local value={clear=function() data.count=0 end,set_stack=function(other) data.name=other.name;data.quality=other.quality;data.count=other.count end}
  return setmetatable(value,{__index=function(_,key) if key=='valid_for_read' then return data.count>0 end;return data[key] end,__newindex=function(_,key,v) data[key]=v end})
 end
 local function inventory(count)
  local inv={stack(count),valid=true}
  inv.insert=function(item) inv[1].count=inv[1].count+item.count;return item.count end
  inv.get_contents=function() return inv[1].count>0 and {{name=inv[1].name,quality=inv[1].quality.name,count=inv[1].count}} or {} end
  inv.destroy=function() inv.valid=false end
  return inv
 end
 local cargo=inventory(0);local stock=inventory(0);local provider=inventory(0)
 local force={name='player',recipes={}};local spawned=0;local built=0;local allow=false
 local ghost={valid=true,type='entity-ghost',ghost_name='transport-belt',ghost_prototype={items_to_place_this={{name='transport-belt',count=1}}},quality={name='normal'},position={x=1.5,y=0.5},force=force}
 ghost.revive=function() if not allow then return nil end;ghost.valid=false;built=built+1;return {} end
 local surface={name='nauvis'};ghost.surface=surface
 local entity={stop_spider=function() end,valid=true,name='toby-drone',force=force,unit_number=4,surface=surface,position={x=1,y=0},get_inventory=function() return cargo end}
 surface.find_non_colliding_position=function() return entity.position end
 surface.create_entity=function(input) assert(input.name=='toby-drone' and input.force==force);spawned=spawned+1;return entity end
 surface.find_entities_filtered=function(input)
  assert(input.force==force)
  if input.type=='logistic-container' then return {{prototype={logistic_mode='storage'},get_inventory=function() return provider end}} end
  return ghost.valid and {ghost} or {}
 end
 local player={name='alice',index=1,force=force,connected=true,character={},physical_surface=surface,physical_position={x=0,y=0},get_main_inventory=function() return stock end}
 game={tick=0,players={player},forces={force},get_player=function() return player end,create_inventory=function() return inventory(0) end}
 remote={add_interface=function(_,value) api=value end}
 local module=(function() ${source} end)();module.tick()
 assert(spawned==1 and api.read('player','alice').mode=='follow' and not entity.grid)
 module.tick();assert(ghost.valid and built==0 and spawned==1)
 stock[1].count=2;ghost.quality.name='uncommon';module.tick();assert(stock[1].count==2 and ghost.valid)
 ghost.quality.name='normal';module.tick();assert(stock[1].count==2 and ghost.valid and built==0)
 game.tick=120;allow=true;module.tick();assert(stock[1].count==1 and not ghost.valid and built==1)
 assert(api.read('player','alice').built==1 and entity.follow_target==nil)
 stock[1].count=0;provider[1].count=1;ghost.valid=true;game.tick=240
 module.tick();assert(provider[1].count==0 and not ghost.valid and built==2)
 stock[1].count=1;stock[1].is_item_with_entity_data=true;ghost.valid=true;game.tick=360
 module.tick();assert(stock[1].count==1 and ghost.valid and built==2)
 player.connected=false;module.tick();assert(ghost.valid and stock[1].count==1 and not entity.follow_target)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
