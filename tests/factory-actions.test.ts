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
