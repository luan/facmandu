import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

const drone = readFileSync('factorio-mod/facmandu-assistant/drone.lua', 'utf8');
function run(body: string) {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const prelude = `
 table.deepcopy=function(t)if type(t)~='table'then return t end;local r={};for k,v in pairs(t)do r[k]=table.deepcopy(v)end;return r end
 package.preload['drone-visuals']=function()return {clear=function()end,update=function()end,activity=function()end}end
 local calls={inspect=0,place=0,orders=0};local blocked=false
 package.preload['ghost-work']=function()return {run=function(r)
  if r.operation=='inspect' then calls.inspect=calls.inspect+1;return {ready=not blocked,expectedTick=game.tick,blocked={{reason='Site changed'}}} end
  if r.validateOnly then if blocked then error('Order snapshot changed')end;return {validated=true,tick=game.tick}end
  if r.operation=='entities_edit' then calls.orders=calls.orders+1;return {outcomes={{state='upgrade_queued'}}}end
  assert(not blocked);calls.place=calls.place+1;return {operation='place_blueprint',complete=true,placed=#r.entities,placed_tiles=0}
 end}end
 local force={name='player',recipes={},is_chunk_charted=function(_,at)return at[1]>=0 end}
 local surface={name='nauvis'}
 local alice={name='Alice',index=1,force=force,connected=true,character={},physical_surface=surface,physical_position={x=0,y=0},insert=function()error('Ghost work must not touch inventory')end}
 local bob={name='Bob',index=2,force=force,connected=true,character={},physical_surface=surface,physical_position={x=0,y=0}}
 local e={name='toby-ghost-drone',valid=true,unit_number=4,force=force,surface=surface,position={x=0,y=0},destructible=true}
 e.teleport=function(p,s)e.position={x=p.x,y=p.y};if s then e.surface=s end;return true end
 surface.find_non_colliding_position=function()return {x=0,y=0}end;surface.create_entity=function()return e end
 storage={};game={tick=100,players={},forces={player=force},surfaces={nauvis=surface},get_player=function(n)if n==1 or n=='Alice'then return alice elseif n==2 or n=='Bob'then return bob end end}
 helpers={table_to_json=function()return 'bounded'end};defines={inventory={spider_trunk=1,spider_trash=2}}
 local api;remote={add_interface=function(_,value)api=value end}
 local module=assert(load([====[${drone}]====]))();module.init();module.bind(alice,e)
 local function advance(n)for i=1,n do game.tick=game.tick+1;module.tick()end end
 `;
	const status = lauxlib.luaL_dostring(state, to_luastring(prelude + body));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
}

test('Toby flies quickly, is invulnerable and has no material or robot work', () => {
	run(`local snapshot=api.read('player','Alice')
 assert(snapshot.ghostOnly and snapshot.invulnerable and snapshot.cargo==nil and not e.operable and not e.enable_logistics_while_moving)
 assert(api.features().ghostOnly and api.features().invulnerable and api.features().inventory==false and api.features().robots==false)
 assert(not pcall(api.command,'enemy','Alice','stay',snapshot))
 assert(not pcall(module.bind,bob,e))
 local moving=api.command('player','Alice','move',snapshot,{x=600,y=0})
 assert(not pcall(api.command,'player','Alice','stay',snapshot),'Stale move must be rejected')
 advance(1);assert(e.position.x==0.8,'Flight must advance every tick');advance(4);assert(e.position.x==4 and e.position.y==0,'48 tiles/sec across five individual ticks')
 assert(not pcall(api.command,'player','Alice','move',moving,{x=-100,y=0}),'Unexplored target accepted')
 assert(not pcall(api.command,'player','Alice','move',moving,{x=0/0,y=0}))
 api.command('player','Alice','stay',moving);local before=e.position.x;module.tick();assert(e.position.x==before)
 assert(calls.place==0 and calls.orders==0)
 `);
});

test('drone jobs travel, place only ghosts, survive reloads and deduplicate retries', () => {
	run(`local request={operation='place',force='player',surface='nauvis',label='Pole and belt ghosts',design='abc',expectedDesign='abc',expectedTick=100,position={x=12,y=0},entities={{name='pole'},{name='belt'}}}
 local queued=api.submit(request);assert(queued.owner=='Alice' and queued.job.state=='travelling' and calls.place==0)
 advance(5);assert(e.position.x==4 and api.read('player','Alice').job.state=='travelling')
 module=assert(load([====[${drone}]====]))();module.init()
 advance(20)
 local done=api.read('player','Alice');assert(done.job.state=='done' and done.ghosts==2 and calls.place==1 and e.position.x==12)
 assert(api.submit(request).job.id==queued.job.id and calls.place==1)
 game.tick=200;request.expectedTick=200;local again=api.submit(request);assert(again.job.id~=queued.job.id,'A fresh placement request must recheck the world')
 module.tick();assert(calls.place==2)
 assert(not pcall(api.submit,{operation='place',force='player',surface='nauvis',design='changed',expectedDesign='stale',entities={}}))
 `);
});

test('changed sites block jobs and explicit stop cancels pending ghost work', () => {
	run(`local request={operation='place',force='player',surface='nauvis',label='Ghosts',design='abc',expectedDesign='abc',expectedTick=100,position={x=8,y=0},entities={{name='belt'}}}
 api.submit(request);blocked=true;advance(20)
 assert(api.read('player','Alice').job.state=='blocked' and calls.place==0)
 blocked=false;request.design='retry';request.expectedDesign='retry';request.position.x=20
 api.submit(request);local current=api.read('player','Alice');api.command('player','Alice','stay',current)
 module.tick();assert(api.read('player','Alice').job.state=='cancelled' and calls.place==0)
 `);
});

test('Toby schedules native upgrade and deconstruction markers without constructing or mining', () => {
	run(`local request={operation='entities_edit',force='player',surface='nauvis',label='Upgrade and removal orders',design='orders',expectedTick=100,position={x=8,y=0},edits={{kind='upgrade',to='fast-transport-belt'},{kind='deconstruct'}}}
 local queued=api.submit(request);assert(queued.job.requested==2 and calls.orders==0)
 advance(20);assert(api.read('player','Alice').job.state=='done' and calls.orders==1 and calls.place==0)
 `);
});
