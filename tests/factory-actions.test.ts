import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import {
	factoryActionCommand,
	factoryActionInspectSchema,
	factoryActionSchema
} from '../src/lib/server/factory-actions';

test('factory actions require exact target and observed state', () => {
	assert.equal(
		factoryActionSchema.safeParse({
			operation: 'research_add',
			force: 'player',
			technology: 'automation'
		}).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({ operation: 'train_manual', trainId: 4, manual: false }).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({
			operation: 'logistic_set_request',
			unitNumber: 12,
			item: 'iron-plate',
			count: 10
		}).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({
			operation: 'research_add',
			force: 'player',
			expectedQueue: [],
			technology: 'automation'
		}).success,
		true
	);
});

test('inspection cannot accept write operations', () => {
	assert.equal(
		factoryActionInspectSchema.safeParse({ operation: 'research_inspect', force: 'player' })
			.success,
		true
	);
	assert.equal(
		factoryActionInspectSchema.safeParse({
			operation: 'research_cancel',
			force: 'player',
			expectedQueue: ['automation']
		}).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({ operation: 'research_inspect', force: 'player' }).success,
		false
	);
});

test('wire batches accept only bounded read pairs and cannot request mutations', () => {
	const endpoint = {
		unitNumber: 1,
		name: 'medium-electric-pole',
		position: { x: 0.5, y: 0.5 },
		connectorId: 5
	};
	const pair = {
		source: endpoint,
		target: { ...endpoint, unitNumber: 2, position: { x: 7.5, y: 0.5 } }
	};
	const batch = {
		operation: 'wire_inspect_batch',
		force: 'player',
		surface: 'nauvis',
		connections: [pair]
	};
	assert.equal(factoryActionInspectSchema.safeParse(batch).success, true);
	assert.equal(factoryActionSchema.safeParse(batch).success, false);
	assert.equal(factoryActionInspectSchema.safeParse({ ...batch, connections: [] }).success, false);
	assert.equal(
		factoryActionInspectSchema.safeParse({ ...batch, connections: Array(17).fill(pair) }).success,
		false
	);
	assert.equal(
		factoryActionInspectSchema.safeParse({
			...batch,
			connections: [{ ...pair, operation: 'wire_connect' }]
		}).success,
		false
	);
});

test('wire connections require exact endpoints and fresh observed connection state', () => {
	const endpoint = {
		unitNumber: 12,
		name: 'medium-electric-pole',
		position: { x: 0.5, y: 0.5 },
		connectorId: 5
	};
	const inspected = {
		operation: 'wire_inspect',
		force: 'player',
		surface: 'nauvis',
		source: endpoint,
		target: { ...endpoint, unitNumber: 13 }
	};
	const change = {
		...inspected,
		operation: 'wire_connect',
		expectedTick: 100,
		expectedConnected: false,
		expectedSourceGhost: false,
		expectedTargetGhost: true
	};
	assert.equal(factoryActionInspectSchema.safeParse(inspected).success, true);
	assert.equal(factoryActionSchema.safeParse(change).success, true);
	assert.equal(factoryActionInspectSchema.safeParse(change).success, false);
	for (const missing of [
		'expectedTick',
		'expectedConnected',
		'expectedSourceGhost',
		'expectedTargetGhost'
	])
		assert.equal(factoryActionSchema.safeParse({ ...change, [missing]: undefined }).success, false);
	assert.equal(
		factoryActionSchema.safeParse({ ...change, source: { ...endpoint, connectorId: 0 } }).success,
		false
	);
});

test('native wiring preserves other connections and rejects stale, foreign or unreachable endpoints', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 ${readFileSync('src/lib/server/factory-actions/action.lua', 'utf8')}
 local force={name='player'}
 local p={type='electric-pole',items_to_place_this={{name='medium-electric-pole'}}}
 prototypes={entity={pole=p}}
 local a={type='electric-pole',name='pole',unit_number=1,force=force,position={x=0.5,y=0.5}}
 local b={type='entity-ghost',ghost_name='pole',ghost_prototype=p,unit_number=2,force=force,position={x=7.5,y=0.5}}
 local made,writes=0,0
 local connected,reachable=false,true
 local ca,cb={},{}
 local function connector(e,c)
  e.get_wire_connector=function(id,create)
   assert(id==5)
   if not e.created and create then e.created=true;made=made+1 end
   return e.created and c or nil
  end
 end
 connector(a,ca);connector(b,cb)
 ca.is_connected_to=function(target) assert(target==cb);return connected end
 ca.can_wire_reach=function(target) assert(target==cb);return reachable end
 ca.connect_to=function(target,check,origin)
  assert(target==cb and check==true and origin==defines.wire_origin.player)
  writes=writes+1;connected=true;return true
 end
 ca.disconnect_all=function() error('Unrelated wires must be preserved') end
 defines={wire_origin={player=1}}
 game={tick=100,surfaces={nauvis={find_entities_filtered=function(q)
  if q.position.x==a.position.x then return {a} else return {b} end
 end}}}
 local request={operation='wire_inspect',force='player',surface='nauvis',source={unitNumber=1,name='pole',position=a.position,connectorId=5},target={unitNumber=2,name='pole',position=b.position,connectorId=5}}
 local invalid={unitNumber=99,name='pole',position=b.position,connectorId=5}
 local batch=action({operation='wire_inspect_batch',force='player',surface='nauvis',connections={{source=request.source,target=request.target},{source=request.source,target=invalid}}})
 assert(batch.tick==100 and #batch.connections==2 and batch.connections[1].ok and not batch.connections[2].ok)
 assert(batch.connections[1].result.tick==batch.tick and not batch.connections[1].result.connected and made==0 and writes==0)
 local snapshot=action(request)
 assert(not snapshot.connected and not snapshot.sourceGhost and snapshot.targetGhost and made==0 and writes==0)
 request.operation='wire_connect';request.expectedTick=snapshot.tick;request.expectedConnected=snapshot.connected;request.expectedSourceGhost=snapshot.sourceGhost;request.expectedTargetGhost=snapshot.targetGhost
 assert(action(request).connected and writes==1 and made==2)
 assert(not pcall(action,request) and writes==1,'Concurrent connections need fresh inspection')
 connected=false;reachable=false
 assert(not pcall(action,request) and writes==1,'Native wire reach must be enforced')
 request.operation='wire_inspect';assert(action(request).canReach==false)
 request.operation='wire_connect';reachable=true;game.tick=4001
 assert(not pcall(action,request) and writes==1)
 game.tick=100;b.force={name='other'}
 assert(not pcall(action,request) and writes==1)
 b.force=force;b.unit_number=3
 assert(not pcall(action,request) and writes==1)
 b.unit_number=2;b.type='electric-pole';b.name='pole'
 assert(not pcall(action,request) and writes==1,'Ghost revival changes the inspected target')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('Toby drone commands require ownership and a fresh movement revision', () => {
	const command = {
		operation: 'drone_command',
		force: 'player',
		owner: 'alice',
		command: 'follow',
		expected: { unitNumber: 12, revision: 2, surface: 'nauvis' }
	};
	assert.equal(factoryActionSchema.safeParse(command).success, true);
	for (const changed of [
		{ ...command, expected: undefined },
		{ ...command, owner: undefined },
		{ ...command, command: 'spawn' },
		{ ...command, expected: { ...command.expected, revision: -1 } }
	])
		assert.equal(factoryActionSchema.safeParse(changed).success, false);
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('src/lib/server/factory-actions/action.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`${source}
 local called=false
 remote={interfaces={['facmandu-toby-drone']={command=true}},call=function(interface,method,force,owner,mode,expected,position)
  assert(interface=='facmandu-toby-drone' and method=='command' and force=='player' and owner=='alice' and mode=='follow' and expected.revision==2)
  called=true;return {mode=mode}
 end}
 local request={operation='drone_command',force='player',owner='alice',command='follow',expected={unitNumber=12,revision=2,surface='nauvis'},player={name='bob'}}
 assert(not pcall(action,request) and not called)
 request.player.name='alice';assert(action(request).drone.mode=='follow' and called)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('train and requester changes require snapshot fields from inspection', () => {
	const train = {
		operation: 'train_add_stop',
		trainId: 2,
		force: 'player force',
		surface: 'nauvis',
		expectedManual: true,
		expectedGroup: '',
		expectedCurrentIndex: 1,
		expectedScheduleTick: 0,
		expectedStations: [],
		station: 'QA Station',
		wait: { kind: 'time', ticks: 300 }
	};
	assert.equal(factoryActionSchema.safeParse(train).success, true);
	assert.equal(
		factoryActionSchema.safeParse({ ...train, expectedGroup: undefined }).success,
		false
	);
	const requester = {
		operation: 'logistic_set_request',
		unitNumber: 11,
		force: 'player force',
		surface: 'nauvis',
		position: { x: 0.5, y: 4.5 },
		sectionIndex: 1,
		slotIndex: 1,
		expectedRequest: null,
		item: 'iron-plate',
		quality: 'normal',
		count: 100
	};
	assert.equal(factoryActionSchema.safeParse(requester).success, true);
	assert.equal(factoryActionSchema.safeParse({ ...requester, position: undefined }).success, false);
});

test('action input is encoded as data inside a silent command', () => {
	const command = factoryActionCommand({ operation: 'research_inspect', force: 'player' });
	assert.ok(command.startsWith('/silent-command'));
	assert.ok(command.includes('helpers.json_to_table'));
	assert.ok(command.includes('Research queue changed; inspect it again'));
	assert.ok(command.includes('rcon.print(reply)'));
});

test('inserter rotation requires exact inspected state and a cardinal direction', () => {
	const input = {
		operation: 'entity_rotate',
		unitNumber: 12,
		force: 'player',
		surface: 'nauvis',
		position: { x: 0.5, y: 4.5 },
		expectedDirection: 0,
		expectedTick: 100,
		direction: 8
	};
	assert.equal(factoryActionSchema.safeParse(input).success, true);
	for (const field of [
		'unitNumber',
		'force',
		'surface',
		'position',
		'expectedDirection',
		'expectedTick'
	])
		assert.equal(factoryActionSchema.safeParse({ ...input, [field]: undefined }).success, false);
	for (const direction of [-4, 1, 16])
		assert.equal(factoryActionSchema.safeParse({ ...input, direction }).success, false);
	assert.equal(factoryActionInspectSchema.safeParse(input).success, false);
	const ghost = { ...input, operation: 'ghost_cancel' };
	assert.equal(factoryActionSchema.safeParse(ghost).success, true);
	assert.equal(factoryActionInspectSchema.safeParse(ghost).success, false);
	assert.equal(factoryActionSchema.safeParse({ ...ghost, expectedTick: undefined }).success, false);
});

test('native entity edits require fresh exact snapshots and reject duplicate or destructive commands', () => {
	const snapshot = {
		unitNumber: 12,
		name: 'transport-belt',
		position: { x: 0.5, y: 0.5 },
		direction: 0,
		ghost: false,
		recipe: '',
		deconstructing: false
	};
	const input = {
		operation: 'entities_edit',
		force: 'player',
		surface: 'nauvis',
		expectedTick: 120,
		edits: [{ ...snapshot, kind: 'rotate', to: 4 }]
	};
	assert.equal(factoryActionSchema.safeParse(input).success, true);
	for (const changed of [
		{ ...input, expectedTick: undefined },
		{ ...input, edits: [{ ...snapshot, kind: 'destroy' }] },
		{ ...input, edits: [...input.edits, ...input.edits] },
		{ ...input, edits: [{ ...snapshot, kind: 'rotate', to: 5 }] },
		{
			...input,
			edits: Array.from({ length: 17 }, (_, index) => ({
				...snapshot,
				unitNumber: index + 1,
				kind: 'deconstruct'
			}))
		}
	])
		assert.equal(factoryActionSchema.safeParse(changed).success, false);
	assert.equal(
		factoryActionInspectSchema.safeParse({
			operation: 'entities_inspect',
			force: 'player',
			surface: 'nauvis',
			targets: [{ unitNumber: 12, name: 'transport-belt', position: snapshot.position }]
		}).success,
		true
	);
});

test('platform requester inspection preserves manual sections and rejects changed identities or forces', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('src/lib/server/factory-actions/action.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`${source}
 local filter={value={name='card',quality='normal'},min=1000,import_from={name='nauvis'}}
 local section={index=2,valid=true,is_manual=true,filters_count=1,filters={filter},get_slot=function() return filter end}
 section.set_slot=function(index,value) assert(index==1 and value.import_from.name=='nauvis');filter=value;return index end
 local point={get_section=function(index) assert(index==2);return section end}
 local hub={type='space-platform-hub',unit_number=12,force={name='player'},position={x=0,y=0},surface={name='platform-1'},get_requester_point=function() return point end}
 game={surfaces={['platform-1']={find_entities_filtered=function(args) assert(args.type==nil and args.force=='player');return {hub} end}}}
 prototypes={item={card={}},quality={normal={}}}
 local input={operation='logistic_inspect',unitNumber=12,force='player',surface='platform-1',position={x=0,y=0},sectionIndex=2,slotIndex=1}
 local snapshot=action(input).before
 assert(snapshot.request.item=='card' and snapshot.request.count==1000)
 input.operation='logistic_set_request';input.expectedRequest=snapshot.request;input.item='card';input.quality='normal';input.count=1200
 assert(action(input).after.request.count==1200)
 local before=filter
 section.is_manual=false;assert(not pcall(action,input) and filter==before)
 section.is_manual=true;hub.force.name='other';assert(not pcall(action,input) and filter==before)
 hub.force.name='player';hub.unit_number=13;assert(not pcall(action,input) and filter==before)
 game.train_manager={get_train_by_id=function() return {valid=true,carriages={{force={name='other'}}},get_schedule=function() error('Private schedule must not be read') end} end}
 assert(not pcall(action,{operation='train_inspect',trainId=1,force='player'}))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('native upgrade orders preserve entities and quality, reject locked tiers and retain changed orders', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`${readFileSync('src/lib/server/factory-actions/action.lua', 'utf8')}
 local quality={name='normal'}
 local next_proto={name='fast-belt',type='transport-belt',items_to_place_this={{name='fast-belt'}}}
 prototypes={entity={belt={type='transport-belt',items_to_place_this={{name='belt'}},next_upgrade=next_proto},['fast-belt']=next_proto}}
 local force={name='player',recipes={fast={enabled=true,products={{type='item',name='fast-belt'}}}}}
 local queued,queued_quality,orders=nil,nil,0
 local e={valid=true,name='belt',type='transport-belt',force=force,unit_number=12,position={x=.5,y=.5},direction=4,quality=quality}
 e.to_be_deconstructed=function() return false end
 e.get_upgrade_target=function() return queued,queued_quality end
 e.to_be_upgraded=function() return queued~=nil end
 e.order_deconstruction=function() error('Upgrades must not demolish the original') end
 e.destroy=function() error('Upgrades must not destroy the original') end
 e.order_upgrade=function(q) assert(q.force=='player' and q.target.name=='fast-belt' and q.target.quality==quality);orders=orders+1;queued=next_proto;queued_quality=quality;return true end
 e.cancel_upgrade=function(f) assert(f=='player');queued=nil;queued_quality=nil;return true end
 game={tick=120,forces={player=force},surfaces={nauvis={find_entities_filtered=function(q) assert(q.force=='player');return {e} end}}}
 local query={operation='entities_inspect',force='player',surface='nauvis',targets={{unitNumber=12,name='belt',position=e.position}}}
 local snapshot=action(query).entities[1]
 assert(snapshot.nextUpgrade=='fast-belt' and snapshot.upgradingTo=='')
 snapshot.kind='upgrade';snapshot.to='invented'
 local edit={operation='entities_edit',force='player',surface='nauvis',expectedTick=120,edits={snapshot}}
 assert(not pcall(action,edit) and orders==0)
 snapshot.to='fast-belt';force.recipes.fast.enabled=false
 assert(not pcall(action,edit) and orders==0,'Locked tiers must not be queued')
 force.recipes.fast.enabled=true
 assert(action(edit).outcomes[1].state=='upgrade_queued' and orders==1 and e.valid and e.name=='belt')
 assert(not pcall(action,edit) and orders==1,'A stale snapshot must not overwrite an existing order')
 local cancel=action(query).entities[1];cancel.kind='cancel_upgrade'
 edit.edits={cancel};queued_quality={name='rare'}
 assert(not pcall(action,edit) and queued~=nil,'Changed target quality must remain intact')
 queued_quality=quality
 assert(action(edit).outcomes[1].state=='cancelled' and not e.to_be_upgraded() and e.name=='belt')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});

test('recipe assignment fills only freshly inspected empty compatible machines and ghosts', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('src/lib/server/factory-actions/action.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`${source}
 local recipe={name='glass',enabled=true,categories={'smelting'},prototype={surface_conditions={}}}
 local force={name='player',recipes={glass=recipe}}
 local p={type='assembling-machine',crafting_categories={smelting=true},items_to_place_this={{name='furnace'}}}
 prototypes={entity={furnace=p}}
 defines={inventory={crafter_input=1}}
 local current=nil;local writes=0;local empty=true
 local inv={is_empty=function() return empty end}
 local e={valid=true,name='entity-ghost',ghost_name='furnace',ghost_type='assembling-machine',ghost_prototype=p,type='entity-ghost',unit_number=12,force=force,position={x=.5,y=.5},direction=0}
 e.to_be_deconstructed=function() return false end
 e.get_upgrade_target=function() return nil end
 e.get_recipe=function() return current end
 e.set_recipe=function(name) assert(name=='glass');writes=writes+1;current=recipe end
 e.get_inventory=function() return inv end;e.get_output_inventory=function() return nil end;e.get_module_inventory=function() return nil end
 e.get_fluid_contents=function() return {} end
 local surface={find_entities_filtered=function() return {e} end,get_property=function() return 100 end}
 game={tick=120,forces={player=force},surfaces={nauvis=surface}}
 local query={operation='entities_inspect',force='player',surface='nauvis',targets={{unitNumber=12,name='furnace',position=e.position}}}
 local snapshot=action(query).entities[1];snapshot.kind='set_recipe';snapshot.to='glass'
 local request={operation='entities_edit',force='player',surface='nauvis',expectedTick=120,edits={snapshot}}
 recipe.enabled=false;assert(not pcall(action,request) and writes==0);recipe.enabled=true
 recipe.categories={'crafting'};assert(not pcall(action,request) and writes==0);recipe.categories={'smelting'}
 recipe.prototype.surface_conditions={{property='pressure',min=200}};assert(not pcall(action,request) and writes==0);recipe.prototype.surface_conditions={}
 request.expectedTick=121;assert(not pcall(action,request) and writes==0);request.expectedTick=120
 e.force={name='other'};assert(not pcall(action,request) and writes==0);e.force=force
 assert(action(request).outcomes[1].state=='recipe_set' and writes==1 and current==recipe)
 assert(not pcall(action,request) and writes==1,'A stale snapshot must not overwrite a configured recipe')
 local configured=action(query).entities[1];configured.kind='set_recipe';configured.to='glass';request.edits={configured}
 assert(not pcall(action,request) and writes==1,'Even a fresh configured recipe is preserved')
 current=nil;e.type='assembling-machine';e.name='furnace';empty=false
 local built=action(query).entities[1];built.kind='set_recipe';built.to='glass';request.edits={built}
 assert(not pcall(action,request) and writes==1,'Existing items must never be discarded')
 empty=true;assert(action(request).outcomes[1].state=='recipe_set' and writes==2)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});
