import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type JsonObject, normalizeContext } from '@earendil-works/pi-ai';
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import {
	blueprintArtifactSchema,
	blueprintDesignSchema,
	blueprintInputSchema,
	blueprintReferenceSchema,
	blueprintRequestSchema,
	blueprintRowsSchema,
	blueprintTargetSchema,
	expandBlueprintRows,
	measureBuildOutput,
	reviseBlueprintDesign
} from '../src/lib/blueprints';
import { blueprintCommand, blueprintToolJsonSchema } from '../src/lib/server/factory-blueprints';

const design = {
	force: 'player',
	label: 'Belt',
	entities: [{ name: 'transport-belt', position: { x: 0.5, y: 0.5 }, direction: 4 as const }]
};
const target = { ...design, surface: 'nauvis', position: { x: 20, y: 20 } };
test('provider blueprint contracts accept omitted defaults and preserve strict operation boundaries', () => {
	const transcript = normalizeContext({
		messages: [],
		tools: [{ name: 'blueprint_operation', description: '', parameters: blueprintToolJsonSchema }]
	});
	const tool = transcript.messages.flatMap((message) =>
		message.role === 'system' ? (message.toolsAdded ?? []) : []
	)[0];
	assert.ok(tool);
	const validate = (arguments_: JsonObject) =>
		validateToolArguments(tool, {
			type: 'toolCall',
			name: tool.name,
			id: 'contract',
			arguments: arguments_
		});
	const [entity] = design.entities;
	if (!entity) throw new Error('Expected entity');
	const drafts: JsonObject[] = [
		design,
		{
			force: 'player',
			label: 'Row',
			entityRows: [{ entity, count: 2, step: { x: 1, y: 0 } }]
		},
		{ force: 'player', designId: 'a'.repeat(64), removedEntityIndices: [1] }
	];
	for (const args of drafts) assert.doesNotThrow(() => validate({ operation: 'create', args }));
	assert.doesNotThrow(() => validate({ operation: 'inspect', args: target }));
	assert.doesNotThrow(() =>
		validate({
			operation: 'check',
			args: {
				force: 'player',
				designId: 'a'.repeat(64),
				surface: 'nauvis',
				position: { x: 0, y: 0 },
				item: 'plastic-bar'
			}
		})
	);
	assert.throws(() =>
		validate({
			operation: 'check',
			args: {
				force: 'player',
				designId: 'a'.repeat(64),
				surface: 'nauvis',
				position: { x: 0, y: 0 }
			}
		})
	);
	for (const args of [
		{ ...design, arbitrary: true },
		{ ...design, entities: [{ ...design.entities[0], direction: 2 }] },
		{ ...design, designId: 'a'.repeat(64) }
	])
		assert.throws(() => validate({ operation: 'create', args }));
	assert.throws(() => validate({ operation: 'place', args: target }));
});
test('draft removal preserves settings and remaps retained wires while adding compact rows', () => {
	const saved = blueprintDesignSchema.parse({
		force: 'player',
		label: 'Connected draft',
		entities: [
			{ name: 'pipe', position: { x: 0.5, y: 0.5 } },
			{
				name: 'fast-inserter',
				position: { x: 1.5, y: 0.5 },
				pickup_position: { x: 0, y: 2 },
				filters: [{ index: 1, name: 'iron-plate' }],
				use_filters: true,
				wires: [[2, 1, 3, 2]]
			},
			{ name: 'decider-combinator', position: { x: 2.5, y: 0 } }
		],
		wires: [
			[1, 1, 3, 1],
			[2, 2, 3, 1]
		]
	});
	const revision = blueprintReferenceSchema.parse({
		operation: 'create',
		designId: 'a'.repeat(64),
		force: 'player',
		removedEntityIndices: [1],
		entityChanges: [{ index: 2, changes: { direction: 8 } }],
		addedEntityRows: [
			{
				entity: { ...design.entities[0], position: { x: 3.5, y: 0.5 } },
				count: 2,
				step: { x: 1, y: 0 }
			}
		]
	});
	if (revision.operation !== 'create') throw new Error('Expected revision');
	const revised = reviseBlueprintDesign(saved, revision);
	if (revised.operation !== 'create') throw new Error('Expected design');
	assert.equal(revised.entities.length, 4);
	assert.deepEqual(revised.wires, [[1, 2, 2, 1]]);
	assert.deepEqual(revised.entities[0], {
		...saved.entities[1],
		direction: 8,
		wires: [[1, 1, 2, 2]]
	});
	assert.equal(saved.entities.length, 3);
	assert.equal(saved.entities[1]?.direction, 0);
	assert.deepEqual(revised.entities[3]?.position, { x: 4.5, y: 0.5 });
	assert.throws(
		() => reviseBlueprintDesign(saved, { ...revision, removedEntityIndices: [4] }),
		/outside this draft/
	);
	assert.throws(
		() => reviseBlueprintDesign(saved, { ...revision, removedEntityIndices: [2] }),
		/patch and remove/
	);
});
test('native blueprint drafts report both belt sides, rotated endpoints and custom reach without building', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local place={{name='building',count=1}}
 local function prototype(kind,width)
  return {type=kind,tile_width=width,tile_height=width,items_to_place_this=place,has_flag=function() return false end}
 end
 local plant=prototype('assembling-machine',3)
 local inserter=prototype('inserter',1)
 inserter.inserter_pickup_position={x=0,y=-1}
 inserter.inserter_drop_position={x=0,y=1.2}
 local belt=prototype('transport-belt',1);belt.belt_speed=0.03125
 local box=prototype('container',3);box.tile_height=1;box.supports_direction=false
 prototypes={entity={plant=plant,inserter=inserter,belt=belt,box=box}}
 local omit_vectors=false
 game={forces={player={recipes={{enabled=true,products={{type='item',name='building'}}}}}},create_inventory=function()
  local saved
  return {{set_stack=function() end,set_blueprint_entities=function(value) saved=value end,
   get_blueprint_entities=function()
    if not omit_vectors then return saved end
    local result={}
    for i,e in ipairs(saved) do
     local copy={};for k,v in pairs(e) do copy[k]=v end
     copy.pickup_position=nil;copy.drop_position=nil;result[i]=copy
    end
    return result
   end,get_blueprint_tiles=function() return {} end,
   export_stack=function() return '0native' end,cost_to_build={{name='building',count=5}}}}
 end}
 ${readFileSync('src/lib/server/factory-blueprints/blueprint.lua', 'utf8')}
 local fixed=blueprint{operation='create',force='player',label='Nondirectional',entities={
  {name='box',position={x=1.5,y=0.5},direction=4}
 }}
 assert(fixed.entities[1].direction==0 and fixed.entities[1].width==3 and fixed.entities[1].height==1)
 for rotation=0,12,4 do
  local function point(x,y)
   if rotation==4 then return {x=-y,y=x} end
   if rotation==8 then return {x=-x,y=-y} end
   if rotation==12 then return {x=y,y=-x} end
   return {x=x,y=y}
  end
  local function entity(name,x,y,direction,drop)
   return {name=name,position=point(x,y),direction=(direction+rotation)%16,drop_position=drop and point(0,drop)}
  end
  local result=blueprint{operation='create',force='player',label='Both lanes',entities={
   entity('plant',2.5,0.5,0),entity('inserter',2.5,2.5,0),entity('belt',2.5,3.5,4),
   entity('inserter',2.5,4.5,8),entity('plant',2.5,6.5,0)
  }}
  local a,b=table.unpack(result.inserter_transfers)
  assert(a.pickup_entity==1 and a.drop_entity==3 and a.drop_belt_side=='right')
  assert(b.pickup_entity==5 and b.drop_entity==3 and b.drop_belt_side=='left')
  assert(a.belt_lane_items_per_second==7.5 and b.belt_lane_items_per_second==7.5)
  assert(not result.warnings)
  local result=blueprint{operation='create',force='player',label='Custom',entities={
   entity('plant',2.5,0.5,0),entity('inserter',2.5,2.5,0,0.8),entity('belt',2.5,3.5,4)
  }}
  assert(result.inserter_transfers[1].drop_belt_side=='left')
  local single_lane=blueprint{operation='create',force='player',label='One lane',entities={
   entity('inserter',2.5,2.5,0),entity('belt',2.5,3.5,4),entity('belt',3.5,3.5,4),
   entity('inserter',4.5,2.5,0),entity('belt',4.5,3.5,4)
  }}
  assert(#single_lane.warnings==1 and single_lane.warnings[1]:match('7.5 items/s'))
  local isolated=blueprint{operation='create',force='player',label='External',entities={entity('inserter',2.5,2.5,0)}}
  assert(not isolated.inserter_transfers[1].pickup_entity and not isolated.inserter_transfers[1].drop_entity)
 end
 omit_vectors=true
 for _,vectors in ipairs({
  {0,{x=0,y=-1},{x=0,y=1.2}},
  {4,{x=1,y=0},{x=-1.2,y=0}},
  {8,{x=0,y=1},{x=0,y=-1.2}},
  {12,{x=-1,y=0},{x=1.2,y=0}}
 }) do
  local result=blueprint{operation='create',force='player',label='Default reach',entities={
   {name='inserter',position={x=0.5,y=0.5},direction=vectors[1],pickup_position=vectors[2],drop_position=vectors[3]}
  }}
  assert(result.kind=='blueprint')
 end
 local ok,err=pcall(blueprint,{operation='create',force='player',label='Lost custom reach',entities={
  {name='inserter',position={x=0.5,y=0.5},direction=8,pickup_position={x=0,y=2}}
 }})
 assert(not ok and err:match('pickup_position'))
 omit_vectors=false
 defines={build_check_type={manual=1}}
 local force=game.forces.player;force.name='player';force.logistic_networks={}
 local charted=true
 force.is_chunk_charted=function() return charted end
 local surface={name='nauvis',is_chunk_generated=function() return true end,can_place_entity=function() return false end}
 surface.get_tile=function(at)
  assert(charted, 'No terrain reads outside explored area')
  return {name=at.x>0.5 and 'water' or 'grass-1'}
 end
 surface.find_entities_filtered=function(filter)
  if filter.type=='entity-ghost' then return {} end
  assert(charted and filter.area and filter.limit==16)
  return {
   {name='belt',type='transport-belt',position={x=0.5,y=0.5},force=force,unit_number=7},
   {name='tree',type='tree',position={x=0.5,y=0.5},force={name='neutral'}},
   {name='private-enemy-machine',type='assembling-machine',position={x=0.5,y=0.5},force={name='other'}}
  }
 end
 game.surfaces={nauvis=surface};game.tick=100
 local inspection={operation='inspect',force='player',surface='nauvis',position={x=0,y=0},design='site',entities={{name='belt',position={x=0.5,y=0.5},direction=0}}}
 local site=blueprint(inspection)
 assert(not site.ready and site.blocked[1].sampled_tiles[1]=='grass-1' and site.blocked[1].sampled_tiles[2]=='water')
 assert(#site.blocked[1].nearby_entities==2 and site.blocked[1].nearby_entities[1].unit_number==7)
 assert(site.blocked[1].other_force_present and not site.blocked[1].nearby_truncated)
 charted=false
 local unexplored=blueprint(inspection)
 assert(not unexplored.ready and unexplored.blocked[1].sampled_tiles==nil and unexplored.blocked[1].nearby_entities==nil)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
test('compact rows expand exact native positions and preserve settings within the original bounds', () => {
	const rows = {
		operation: 'create',
		force: 'player',
		label: 'Inserters',
		entities: design.entities,
		entityRows: [
			{
				entity: {
					name: 'fast-inserter',
					position: { x: 1.5, y: 2.5 },
					direction: 8,
					pickup_position: { x: 0, y: 2 },
					drop_position: { x: 0, y: -2 },
					filters: [{ index: 1, name: 'iron-plate' }],
					use_filters: true
				},
				count: 3,
				step: { x: 3, y: 0 }
			}
		]
	};
	const expanded = expandBlueprintRows(blueprintRowsSchema.parse(rows));
	if (expanded.operation !== 'create') throw new Error('Expected design');
	assert.deepEqual(
		expanded.entities.map((entity) => entity.position),
		[
			{ x: 0.5, y: 0.5 },
			{ x: 1.5, y: 2.5 },
			{ x: 4.5, y: 2.5 },
			{ x: 7.5, y: 2.5 }
		]
	);
	assert.deepEqual(
		expanded.entities.slice(1).map((entity) => entity.pickup_position),
		Array(3).fill({ x: 0, y: 2 })
	);
	assert.equal(expanded.entities[3]?.use_filters, true);
	assert.equal(expanded.entities[3]?.direction, 8);
	assert.equal(blueprintInputSchema.safeParse(rows).success, true);
	assert.equal(
		blueprintRowsSchema.safeParse({ ...rows, entityRows: [{ ...rows.entityRows[0], count: 200 }] })
			.success,
		false
	);
	assert.throws(() =>
		expandBlueprintRows(
			blueprintRowsSchema.parse({
				...rows,
				entityRows: [{ ...rows.entityRows[0], step: { x: 10000, y: 0 } }]
			})
		)
	);
	assert.equal(
		blueprintRowsSchema.safeParse({
			...rows,
			entityRows: [
				{ ...rows.entityRows[0], entity: { ...rows.entityRows[0]?.entity, wires: [[1, 1, 2, 1]] } }
			]
		}).success,
		false
	);
});
test('blueprints reject arbitrary settings and unbounded layouts at the tool boundary', () => {
	for (const entities of [
		[],
		Array(201).fill(design.entities[0]),
		[{ ...design.entities[0], items: { 'iron-plate': 200 } }],
		[{ ...design.entities[0], position: { x: 0.1, y: 0.5 } }]
	]) {
		assert.equal(
			blueprintRequestSchema.safeParse({ ...design, operation: 'create', entities }).success,
			false
		);
	}
	assert.equal(blueprintRequestSchema.safeParse({ ...design, operation: 'create' }).success, true);
	assert.equal(blueprintRequestSchema.safeParse({ ...target, operation: 'place' }).success, false);
});
test('placement is bound to the inspected design and requires a fresh native tick', () => {
	const expectedDesign = createHash('sha256')
		.update(JSON.stringify(blueprintTargetSchema.parse(target)))
		.digest('hex');
	const request = blueprintRequestSchema.parse({
		...target,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	const entity = request.entities[0];
	if (!entity) throw new Error('Expected entity');
	assert.ok(blueprintCommand(request).startsWith('/silent-command'));
	assert.throws(
		() => blueprintCommand({ ...request, entities: [{ ...entity, name: 'pipe' }] }),
		/Blueprint changed/
	);
	assert.throws(
		() => blueprintCommand({ ...request, label: 'Different blueprint' }),
		/Blueprint changed/
	);
});
test('placement cannot move to another surface or position after inspection', () => {
	const expectedDesign = createHash('sha256')
		.update(JSON.stringify(blueprintTargetSchema.parse(target)))
		.digest('hex');
	const request = blueprintRequestSchema.parse({
		...target,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	assert.throws(
		() => blueprintCommand({ ...request, position: { x: 21, y: 20 } }),
		/Blueprint changed/
	);
	assert.throws(() => blueprintCommand({ ...request, surface: 'gleba' }), /Blueprint changed/);
});
test('rich blueprint artifacts need an importable string and validated layout', () => {
	const artifact = {
		kind: 'blueprint',
		label: 'Belt',
		blueprint: '0native',
		entities: [{ ...design.entities[0], width: 1, height: 1 }],
		cost: [{ name: 'transport-belt', count: 1 }]
	};
	assert.equal(blueprintArtifactSchema.safeParse(artifact).success, true);
	assert.equal(
		blueprintArtifactSchema.safeParse({ ...artifact, blueprint: 'https://example.com' }).success,
		false
	);
	assert.equal(blueprintArtifactSchema.safeParse({ ...artifact, entities: [] }).success, false);
});

test('foundation layouts use integer tiles and remain bound to the inspected layout', () => {
	const foundation = {
		force: 'player',
		label: 'Foundation',
		entities: [],
		tiles: [{ name: 'space-platform-foundation', position: { x: 0, y: 0 } }]
	};
	assert.equal(
		blueprintRequestSchema.safeParse({ ...foundation, operation: 'create' }).success,
		true
	);
	assert.equal(
		blueprintRequestSchema.safeParse({
			...foundation,
			operation: 'create',
			tiles: [{ name: 'space-platform-foundation', position: { x: 0.5, y: 0 } }]
		}).success,
		false
	);
	assert.equal(
		blueprintRequestSchema.safeParse({
			...foundation,
			operation: 'create',
			tiles: Array(1025).fill(foundation.tiles[0])
		}).success,
		false
	);
	const placement = { ...foundation, surface: 'platform-1', position: { x: 0, y: 0 } };
	const expectedDesign = createHash('sha256')
		.update(JSON.stringify(blueprintTargetSchema.parse(placement)))
		.digest('hex');
	const request = blueprintRequestSchema.parse({
		...placement,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	assert.throws(
		() =>
			blueprintCommand({
				...request,
				tiles: [{ name: 'space-platform-foundation', position: { x: 1, y: 0 } }]
			}),
		/Blueprint changed/
	);
	assert.equal(
		blueprintArtifactSchema.safeParse({
			kind: 'blueprint',
			label: 'Foundation',
			blueprint: '0native',
			tiles: foundation.tiles,
			warnings: ['Locked recipe'],
			cost: [{ name: 'space-platform-foundation', count: 1 }]
		}).success,
		true
	);
});

test('configured inserters preserve settings and bind placement to inspected configuration', () => {
	const configured = {
		...target,
		entities: [
			{
				name: 'inserter',
				position: { x: 0.5, y: 0.5 },
				direction: 0 as const,
				filters: [{ index: 1, name: 'iron-plate' }],
				use_filters: true,
				pickup_position: { x: 0, y: -2 },
				drop_position: { x: 0.25, y: 2.25 },
				control_behavior: { circuit_read_hand_contents: true },
				wires: [[1, 1, 2, 1]]
			},
			{ name: 'inserter', position: { x: 2.5, y: 0.5 }, direction: 0 as const }
		]
	};
	const parsed = blueprintTargetSchema.parse(configured);
	assert.deepEqual(parsed.entities[0], configured.entities[0]);
	const expectedDesign = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
	const request = blueprintRequestSchema.parse({
		...configured,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	assert.ok(blueprintCommand(request).startsWith('/silent-command'));
	assert.throws(
		() =>
			blueprintCommand({
				...request,
				entities: parsed.entities.map((entity) => ({ ...entity, use_filters: false }))
			}),
		/Blueprint changed/
	);
	assert.equal(
		blueprintTargetSchema.safeParse({
			...configured,
			entities: [{ ...configured.entities[0], pickup_position: { x: 10000, y: 0 } }]
		}).success,
		false
	);
});

test('collector filters and native combinator sections survive the tool boundary', () => {
	const entities = [
		{
			name: 'asteroid-collector',
			position: { x: 0.5, y: 0.5 },
			direction: 0,
			'chunk-filter': [{ index: 1, name: 'oxide-asteroid-chunk' }],
			control_behavior: {
				circuit_read_contents: true,
				include_hands: true,
				circuit_enabled: true,
				circuit_condition: {
					first_signal: { type: 'virtual', name: 'signal-A' },
					comparator: '>',
					constant: 0
				}
			}
		},
		{
			name: 'constant-combinator',
			position: { x: 4.5, y: 0.5 },
			direction: 0,
			control_behavior: {
				sections: {
					sections: [
						{
							index: 1,
							filters: [{ index: 1, type: 'item', name: 'oxide-asteroid-chunk', count: 1 }]
						}
					]
				}
			}
		}
	];
	assert.deepEqual(blueprintTargetSchema.parse({ ...target, entities }).entities, entities);
	assert.equal(
		blueprintTargetSchema.safeParse({
			...target,
			entities: [{ ...entities[0], 'chunk-filter': [{ index: 0, name: 'oxide-asteroid-chunk' }] }]
		}).success,
		false
	);
});

test('blueprint-level wires are accepted and remain bound to placement inspection', () => {
	const configured = {
		...target,
		wires: [[1, 1, 2, 1]],
		entities: [
			{ name: 'constant-combinator', position: { x: 0.5, y: 0.5 }, direction: 0 },
			{ name: 'inserter', position: { x: 2.5, y: 0.5 }, direction: 0 }
		]
	};
	const parsed = blueprintTargetSchema.parse(configured);
	const expectedDesign = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
	const request = blueprintRequestSchema.parse({
		...configured,
		operation: 'place',
		expectedTick: 10,
		expectedDesign
	});
	if (request.operation !== 'place') throw new Error('Expected placement');
	assert.ok(blueprintCommand(request).startsWith('/silent-command'));
	assert.throws(() => blueprintCommand({ ...request, wires: [] }), /Blueprint changed/);
});

test('saved blueprint references retain omitted entity settings and require exact placement evidence', () => {
	const designId = 'a'.repeat(64);
	const revision = blueprintInputSchema.parse({
		operation: 'create',
		force: 'player',
		designId,
		entityChanges: [{ index: 1, changes: { recipe: 'plastic-bar' } }],
		addedEntityRows: [{ entity: design.entities[0], count: 10, step: { x: 1, y: 0 } }]
	});
	if (!('designId' in revision) || revision.operation !== 'create')
		throw new Error('Expected reference');
	assert.deepEqual(revision.entityChanges[0]?.changes, { recipe: 'plastic-bar' });
	assert.equal(revision.addedEntityRows?.[0]?.count, 10);
	for (const invalid of [
		{ ...revision, designId: '../secret' },
		{ ...revision, entityChanges: [{ index: 0, changes: { direction: 4 } }] },
		{ ...revision, entityChanges: [{ index: 1, changes: { items: { 'iron-plate': 1000 } } }] },
		{ operation: 'place', force: 'player', designId, surface: 'nauvis', position: { x: 0, y: 0 } },
		{
			operation: 'inspect',
			force: 'player',
			designId,
			surface: 'nauvis',
			position: { x: 0.5, y: 0 }
		}
	])
		assert.equal(blueprintInputSchema.safeParse(invalid).success, false);
});

test('build delivery uses game ticks and rejects short, changed or drained samples', () => {
	const before = {
		tick: 100,
		item: 'plastic-bar',
		outputs: [
			{ unit_number: 1, count: 20 },
			{ unit_number: 2, count: 0 }
		]
	};
	const after = {
		...before,
		tick: 3700,
		outputs: [
			{ unit_number: 1, count: 470 },
			{ unit_number: 2, count: 450 }
		]
	};
	const measured = measureBuildOutput(before, after);
	assert.equal(measured.measured, true);
	if (!measured.measured) throw new Error('Expected a delivery measurement');
	assert.equal(measured.per_min, 900);
	assert.equal(measured.delivered, 900);
	for (const invalid of [
		{ ...after, tick: 101 },
		{ ...after, tick: 0 },
		{ ...after, item: 'coal' },
		{
			...after,
			outputs: [
				{ unit_number: 3, count: 470 },
				{ unit_number: 2, count: 450 }
			]
		},
		{
			...after,
			outputs: [
				{ unit_number: 1, count: 10 },
				{ unit_number: 2, count: 910 }
			]
		}
	])
		assert.equal(measureBuildOutput(before, invalid).measured, false);
});
