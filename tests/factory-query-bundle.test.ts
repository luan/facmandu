import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import { factoryBundle } from '../src/lib/server/factory-query-bundle';

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
