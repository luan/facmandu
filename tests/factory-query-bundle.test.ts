import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import { factoryBundle, factoryCommand } from '../src/lib/server/factory-query-bundle';

const root = 'src/lib/server/factory-query/';
const sources = Object.fromEntries(
	readdirSync(root, { recursive: true })
		.filter((path): path is string => typeof path === 'string' && path.endsWith('.lua'))
		.map((path) => [`./factory-query/${path}`, readFileSync(root + path, 'utf8')])
);

test('selected native lookup bundles retain dependencies, force checks and planner isolation', () => {
	const bundle = factoryBundle(sources, [
		'scripts.tools.basics',
		'scripts.tools.game_time',
		'scripts.tools.mod_planners'
	]);
	assert.ok(bundle.length < factoryBundle(sources).length / 4);
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 remote={interfaces={}}
 game={tick=120,ticks_played=120,connected_players={},forces={player={name='player',players={},connected_players={}}}}
 ${bundle}
 assert(functions.list_forces({}).forces[1].name=='player')
 assert(functions.game_time({force='player'}).tick==120)
 assert(not pcall(functions.game_time,{}))
 assert(not pcall(functions.game_time,{force='other'}))
 assert(not pcall(functions.read_factory_plan,{force='player',player='other'}))
 assert(functions.route_belt==nil)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('every catalog lookup can load its reviewed owner without the complete engine', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = `
 defines={inventory={crafter_input=1},flow_precision_index={},space_platform_state={no_path=1,no_schedule=2,on_the_path=3,paused=4,starter_pack_on_the_way=5,starter_pack_requested=6,waiting_at_station=7,waiting_for_departure=8,waiting_for_starter_pack=9}}
 remote={interfaces={}}
 ${factoryBundle(sources)}
 local owners={}
 for name,entry in pairs(functions.agent_tools_v1().tools) do
  assert(type(entry.module)=='string',name)
  local owner=require(entry.module)
  if owner.provider then owner=owner.provider(native_remote) end
  assert(type(owner.functions[name])=='function',name)
  assert(owner.manifest[name],name)
  owners[entry.module]=true
 end
 local names={} for name in pairs(owners) do names[#names+1]=name end
 table.sort(names)
 return table.concat(names,"\\n")
 `;
	const status = lauxlib.luaL_dostring(state, to_luastring(source));
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	for (const owner of lua.lua_tojsstring(state, -1).split('\n')) {
		const selected = lauxlib.luaL_newstate();
		lualib.luaL_openlibs(selected);
		const setup = source.slice(0, source.indexOf('local native_remote'));
		const result = lauxlib.luaL_dostring(
			selected,
			to_luastring(`${setup}
${factoryBundle(sources, [owner])}
assert(next(functions.agent_tools_v1().tools))`)
		);
		assert.equal(result, lua.LUA_OK, `${owner}: ${lua.lua_tojsstring(selected, -1)}`);
	}
	assert.throws(() => factoryBundle(sources, ['unreviewed.module']), /Unknown query module/);
});

test('native read batches share unused reply space and preserve every outcome within the wire limit', () => {
	for (const overflow of [false, true]) {
		const queries = Array.from({ length: 16 }, (_, index) => ({
			tool: index === 15 || (!overflow && index > 0) ? 'game_time' : 'list_players',
			args: { force: 'player', limit: 50 }
		}));
		const state = lauxlib.luaL_newstate();
		lualib.luaL_openlibs(state);
		const request = `{op='batch',queries={${queries.map((q) => `{tool='${q.tool}',args={force='player',limit=50}}`).join(',')}}}`;
		const command = factoryCommand(sources, { op: 'batch', queries }, [
			'scripts.tools.basics',
			'scripts.tools.game_time'
		]).replace(/^\/silent-command /u, '');
		const status = lauxlib.luaL_dostring(
			state,
			to_luastring(`
 local function encode(value)
  if type(value)=='string' then return '"'..value:gsub('\\\\','\\\\\\\\'):gsub('"','\\\\"')..'"' end
  if type(value)~='table' then return tostring(value) end
  local rows={}
  if #value>0 then for _,v in ipairs(value) do rows[#rows+1]=encode(v) end;return '['..table.concat(rows,',')..']' end
  for k,v in pairs(value) do rows[#rows+1]=encode(k)..':'..encode(v) end
  return '{'..table.concat(rows,',')..'}'
 end
 local captured
 helpers={json_to_table=function() return ${request} end,table_to_json=encode}
 rcon={print=function(value) captured=value end}
 remote={interfaces={}}
 local force={name='player',players={},connected_players={}}
 for i=1,50 do force.players[i]={name=string.rep('a',128)..i,connected=true,admin=false} end
 game={tick=120,ticks_played=120,connected_players=force.players,forces={player=force}}
 ${command}
 assert(captured and #captured<=65536)
 return captured
 `)
		);
		assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
		const reply = JSON.parse(lua.lua_tojsstring(state, -1));
		assert.equal(reply.ok, true);
		assert.equal(reply.result.results.length, 16);
		assert.equal(
			reply.result.results[0].ok,
			true,
			'A detailed result uses space left by small reads'
		);
		assert.equal(
			reply.result.results[15].result.tick,
			120,
			'Later small reads retain their result'
		);
		assert.equal(
			reply.result.results.some((row: { ok: boolean }) => !row.ok),
			overflow
		);
	}
});

test('host catalog loads reviewed contracts with real engine enum values and no game access', async () => {
	const { factoryCatalog } = await import('../src/lib/server/factory-query-catalog');
	const catalog = factoryCatalog(sources, {
		inventory: { crafter_input: 2 },
		flow_precision_index: { five_seconds: 0, one_minute: 1 },
		space_platform_state: {
			waiting_for_starter_pack: 0,
			starter_pack_requested: 8,
			starter_pack_on_the_way: 1,
			on_the_path: 2,
			waiting_for_departure: 3,
			no_schedule: 4,
			no_path: 5,
			waiting_at_station: 6,
			paused: 7
		}
	});
	const { z } = await import('zod');
	const parsed = z
		.object({
			v: z.literal(1),
			tools: z.record(
				z.string(),
				z.object({ module: z.string(), desc: z.string(), params: z.record(z.string(), z.string()) })
			)
		})
		.parse(catalog);
	assert.ok(Object.keys(parsed.tools).length >= 40);
	assert.match(parsed.tools.item_rate?.params.window ?? '', /five_seconds, one_minute/);
	assert.ok(parsed.tools.toby_drone);
	for (const [name, tool] of Object.entries(parsed.tools)) {
		assert.match(tool.module, /^scripts\.(tools|sweep)\./);
		assert.match(tool.params.force ?? '', name === 'list_forces' ? /optional/ : /string!/);
	}
});

test('science snapshots discover modded packs, sum qualities and surfaces, and keep limits explicit', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 defines={flow_precision_index={one_minute=1}}
 remote={interfaces={}}
 prototypes={item={['automation-science-pack']={},['modded-card']={}},quality={normal={},uncommon={}}}
 local force={name='player',technologies={
  a={research_unit_ingredients={{name='automation-science-pack',amount=1},{name='modded-card',amount=2}}},
  b={research_unit_ingredients={{name='modded-card',amount=3}}}
 },research_progress=0.25}
 force.current_research=force.technologies.a;force.current_research.name='electronics'
 force.get_item_production_statistics=function(surface) return {get_flow_count=function(a)
  return (a.category=='input' and 10 or 2)*(a.name.quality=='uncommon' and 2 or 1)*surface.index
 end} end
 game={tick=120,forces={player=force},surfaces={a={name='nauvis',index=1},b={name='platform-1',index=2}}}
 ${factoryBundle(sources, ['scripts.tools.production'])}
 local result=functions.science_summary{force='player'}
 assert(result.total==2 and #result.sciences==2 and result.window=='one_minute')
 assert(result.sciences[1].item=='automation-science-pack' and tonumber(result.sciences[1].produced_per_min)==90)
 assert(tonumber(result.sciences[1].consumed_per_min)==18 and tonumber(result.sciences[1].net_per_min)==72)
 assert(result.sciences[2].required_per_unit==2 and result.research.name=='electronics')
 assert(#result.sciences[2].surface_rates==2 and result.sciences[2].surface_rates[2][1]==2)
 force.current_research=nil;assert(functions.science_summary{force='player'}.research.active==false)
 assert(not pcall(functions.science_summary,{}));assert(not pcall(functions.science_summary,{force='other'}))
 assert(not pcall(functions.science_summary,{force='player',window='wrong'}))
 force.technologies={}
 for i=1,80 do local name='card-'..i;prototypes.item[name]={};force.technologies[name]={research_unit_ingredients={{name=name,amount=1}}} end
 prototypes.item['z-current-card']={};force.current_research={name='current',research_unit_ingredients={{name='z-current-card',amount=1}}};force.technologies.current=force.current_research
 for i=3,17 do game.surfaces[i]={name='surface-'..i,index=i} end
 local limited=functions.science_summary{force='player'}
 assert(limited.truncated and limited.total==81 and limited.shown==64 and limited.surfaces_total==17 and limited.surfaces_shown==16)
 assert(limited.sciences[1].item=='z-current-card','Active research packs must survive the result bound')
 assert(#limited.sciences[1].surface_rates==4 and limited.sciences[1].surface_rates_total==16)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('machine snapshots include actual attached loaders and their upstream belt paths', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const root = resolve('src/lib/server/factory-query');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${root}/?.lua;`)}..package.path
 defines={inventory={crafter_input=1},entity_status={working=1}}
 script={active_mods={base='2.0.0'}}
 prototypes={entity={plant={},loader={},belt={}},item={},fluid={}}
 local force={name='player',is_chunk_charted=function() return true end}
 local inv={valid=true,get_contents=function() return {} end}
 local plant={valid=true,name='plant',type='assembling-machine',force=force,unit_number=1,position={x=.5,y=.5},bounding_box={left_top={x=-1,y=-1},right_bottom={x=2,y=2}},status=1,active=true,crafting_progress=0,crafting_speed=1,energy=100,get_recipe=function() return {name='glass',ingredients={},products={}} end,is_crafting=function() return true end,is_connected_to_electric_network=function() return true end,get_inventory=function() return inv end,get_output_inventory=function() return inv end,get_module_inventory=function() return inv end,get_fluid_contents=function() return {} end}
 local belt={valid=true,name='belt',type='transport-belt',force=force,unit_number=3,position={x=.5,y=-3.5},direction=8,belt_neighbours={inputs={},outputs={}}}
 local loader={valid=true,name='loader',type='loader-1x1',force=force,unit_number=2,position={x=.5,y=-2.5},direction=8,status=1,loader_type='input',loader_container=plant,prototype={belt_speed=.03125},bounding_box={left_top={x=0,y=-3},right_bottom={x=1,y=-2}},belt_neighbours={inputs={belt},outputs={}},get_wire_connectors=function() return {} end,get_item_count=function() return 2 end,get_max_transport_line_index=function() return 2 end,get_transport_line=function() return {get_item_count=function() return 1 end,get_contents=function() return {{name='sand',count=1}} end} end}
 local scans=0
 local surface={valid=true,name='nauvis',find_entities_filtered=function(q)
  assert(q.force==force or q.force=='player')
  if q.area then scans=scans+1;return {loader} end
  return q.position.y<0 and {loader} or {plant}
 end}
 game={tick=99,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  return {[1]={set_stack=function() end,create_blueprint=function() return {[1]=loader} end,get_blueprint_entities=function() return {{type='input',filters={{index=1,name='sand'}}}} end},valid=true,destroy=function() end}
 end}
 local inspect=require('scripts.tools.machine_diagnostics').functions.inspect_machine
 local result=inspect{force='player',surface='nauvis',x=.5,y=.5}
 assert(result.connections.total==1 and result.connections.items[1].role=='input')
 local transport=result.connections.items[1].transport
 assert(transport.loader_container.unit_number==1 and transport.loader_type=='input')
 assert(transport.blueprint_settings.filters[1].name=='sand')
 assert(#transport.belt_trace.nodes==2 and transport.belt_trace.nodes[2].unit_number==3 and transport.belt_trace.direction=='upstream')
 local simple=inspect{force='player',surface='nauvis',x=.5,y=.5,connections=false}
 assert(simple.connections==nil and scans==1)
 loader.loader_container={};assert(inspect{force='player',surface='nauvis',x=.5,y=.5}.connections.total==0,'Proximity is not a machine connection')
 assert(not pcall(inspect,{force='enemy',surface='nauvis',x=.5,y=.5}))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});

test('coordinate inspections select visible factory entities while explicit IDs retain helper access', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${resolve('src/lib/server/factory-query')}/?.lua;`)}..package.path
 local force={name='player'}
 local hidden={valid=true,name='hidden-pole',type='electric-pole',unit_number=1,position={x=.5,y=.5},prototype={has_flag=function(flag) assert(flag=='not-selectable-in-game');return true end}}
 local machine={valid=true,name='plant',type='assembling-machine',unit_number=2,position={x=.5,y=.5},prototype={has_flag=function() return false end}}
 local surface={valid=true,name='nauvis',find_entities_filtered=function(q) assert(q.force=='player');return {hidden,machine} end}
 game={forces={player=force},surfaces={nauvis=surface}}
 prototypes={entity={plant={},['hidden-pole']={}}}
 local find=require('scripts.tools.target').find
 assert(find{force='player',surface='nauvis',x=.5,y=.5}==machine)
 assert(find{force='player',surface='nauvis',x=.5,y=.5,unit_number=1}==hidden)
 hidden.prototype.has_flag=function() return false end;hidden.prototype.selectable_in_game=false
 assert(find{force='player',surface='nauvis',x=.5,y=.5}==machine)
 hidden.prototype.selectable_in_game=true;hidden.prototype.selection_box={left_top={x=0,y=0},right_bottom={x=0,y=0}}
 assert(find{force='player',surface='nauvis',x=.5,y=.5}==machine)
 hidden.prototype.selection_box=nil
 local entity,result=find{force='player',surface='nauvis',x=.5,y=.5}
 assert(entity==nil and result.ambiguous,'Two real overlapping entities still need an explicit choice')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});

test('mining snapshots read charted reserves and actual output without invoking crafting APIs', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.path=${JSON.stringify(`${resolve('src/lib/server/factory-query')}/?.lua;`)}..package.path
 defines={entity_status={working=1},inventory={}}
 local force={name='player',mining_drill_productivity_bonus=.1,is_chunk_charted=function(_,p) return p.x<2 end}
 local stone={valid=true,name='stone',position={x=.5,y=.5},amount=100,prototype={resource_category='basic-solid',mineable_properties={mining_time=1,products={{name='stone',type='item',amount=1}}}}}
 local hidden={valid=true,name='stone',position={x=64.5,y=.5},amount=999,prototype=stone.prototype}
 local copper={valid=true,name='copper',position={x=1.5,y=.5},amount=200,prototype={resource_category='liquid'}}
 local belt={valid=true,name='belt',type='transport-belt',force=force,unit_number=2,position={x=2.5,y=.5},direction=4,status=1,prototype={belt_speed=.03125},belt_neighbours={inputs={},outputs={}},get_item_count=function() return 1 end,get_max_transport_line_index=function() return 2 end,get_transport_line=function() return {get_item_count=function() return 0 end,get_contents=function() return {} end} end}
 local drill={valid=true,name='drill',type='mining-drill',force=force,unit_number=1,position={x=.5,y=.5},prototype={mining_speed=.5,resource_categories={['basic-solid']=true}},status=1,active=true,energy=100,mining_area={{-2,-2},{3,3}},mining_target=stone,drop_position=belt.position,drop_target=belt,is_connected_to_electric_network=function() return true end,get_module_inventory=function() return nil end,get_fuel_inventory=function() return nil end}
 local surface={valid=true,name='nauvis',find_entities_filtered=function(q)
  if q.type=='resource' then assert(q.force=='neutral' and q.limit==2048 and q.area==drill.mining_area);return {stone,hidden,copper} end
  assert(q.force=='player');return q.position.x==.5 and {drill} or {belt}
 end}
 prototypes={entity={drill=drill.prototype,belt=belt.prototype},item={},fluid={}}
 game={tick=100,forces={player=force},surfaces={nauvis=surface}}
 local inspect=require('scripts.tools.machine_diagnostics').functions.inspect_machine
 local args={force='player',surface='nauvis',x=.5,y=.5}
 local result=inspect(args)
 assert(result.found and result.type=='mining-drill' and result.base_mining_speed==.5)
 assert(result.mining_target.mining.products[1].name=='stone' and result.force_mining_productivity_bonus==.1)
 assert(result.resources.scanned==3 and result.resources.charted_tiles==2 and not result.resources.truncated)
 assert(result.resources.items[1].name=='copper' and not result.resources.items[1].compatible)
 assert(result.resources.items[2].amount==100 and result.resources.items[2].compatible)
 assert(result.drop_target.unit_number==2 and #result.output_transport.belt_trace.nodes==1)
 args.connections=false;assert(not inspect(args).output_transport)
 drill.mining_target=nil;drill.drop_target=nil;result=inspect(args)
 assert(result.found and not result.mining_target and not result.drop_target and not result.output_transport)
 drill.drop_target=belt;belt.force={name='enemy'};assert(not inspect(args).drop_target)
 belt.force=force;belt.position.x=64.5;assert(not inspect(args).drop_target)
 assert(not pcall(inspect,{force='enemy',surface='nauvis',x=.5,y=.5}))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});
