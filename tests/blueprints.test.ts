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
	combineBlueprintDesigns,
	expandBlueprintRows,
	measureBuildOutput,
	reviseBlueprintDesign
} from '../src/lib/blueprints';
import {
	blueprintCommand,
	blueprintToolJsonSchema,
	parseBlueprintToolRequest
} from '../src/lib/server/factory-blueprints';

const blueprintSource = `${readFileSync('src/lib/server/factory-blueprints/blueprint.lua', 'utf8')}
local source_blueprint=blueprint
local function blueprint(request) return source_blueprint(request,(function()
${readFileSync('src/lib/server/factory-query/scripts/tools/territory.lua', 'utf8')}
end)()) end`;

const design = {
	force: 'player',
	label: 'Belt',
	entities: [{ name: 'transport-belt', position: { x: 0.5, y: 0.5 }, direction: 4 as const }]
};
const target = { ...design, surface: 'nauvis', position: { x: 20, y: 20 } };
test('site search checks the complete footprint without world writes and stays bounded', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',recipes={{enabled=true,products={{type='item',name='building'}}}},is_chunk_charted=function() return true end}
 local p={type='container',tile_width=1,tile_height=1,items_to_place_this={{name='building'}},has_flag=function() return false end}
 prototypes={entity={building=p}}
 local surface={name='nauvis',is_chunk_generated=function() return true end,
  get_territory_for_chunk=function(c) if c.x==0 and c.y==0 then return {get_segmented_units=function() return {{valid=true,prototype={name='small-demolisher'}}} end} end end,
  can_place_entity=function(q) return q.position.y<0 end,
  find_entities_filtered=function() return {} end,
  count_entities_filtered=function() return 0 end,
  create_entity=function() error('Site search must not create entities') end}
 game={tick=100,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  local saved
  return {{set_stack=function() end,set_blueprint_entities=function(e) saved=e end,get_blueprint_entities=function() return saved end,get_blueprint_tiles=function() return {} end,cost_to_build={}}}
 end}
 defines={build_check_type={manual=1}}
 ${blueprintSource}
 local request={operation='find_site',force='player',surface='nauvis',position={x=0,y=0},radius=16,label='Core',entities={
  {name='building',position={x=0.5,y=0.5},direction=0},{name='building',position={x=8.5,y=0.5},direction=0}}}
 local result=blueprint(request)
 assert(result.operation=='find_blueprint_site' and #result.sites>0)
 assert(result.sites[1].x==0 and result.sites[1].y==-8)
 for _,site in ipairs(result.sites) do assert(site.y<0) end
 request.radius=0
 assert(#blueprint(request).sites==0,'A clear center cannot hide a guarded part of the layout')
 surface.get_territory_for_chunk=function() return nil end
 surface.can_place_entity=function(q) return q.position.x==1.5 and q.position.y==0.5 end
 request.entities={{name='building',position={x=.5,y=.5},direction=0}};request.radius=8
 local precise=blueprint(request)
 assert(#precise.sites==1 and precise.sites[1].x==1 and precise.sites[1].y==0,'A one-tile repair must not jump eight tiles')
 request.radius=0;assert(#blueprint(request).sites==0,'Fine repairs must obey the requested radius')
 request.entities={}
 for i=1,65 do request.entities[i]={name='building',position={x=i+0.5,y=0.5},direction=0} end
 request.radius=128;surface.can_place_entity=function() return false end
 local bounded=blueprint(request)
 assert(bounded.truncated and bounded.checked_positions<=64 and bounded.native_check_budget<=4096)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	assert.throws(() =>
		blueprintReferenceSchema.parse({
			operation: 'find_site',
			force: 'player',
			designId: 'a'.repeat(64),
			surface: 'nauvis',
			position: { x: 0, y: 0 },
			radius: 129
		})
	);
});
test('build checks identify actual product output belts rather than ingredient feeds', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',recipes={{enabled=true,products={{type='item',name='inserter'}}}}}
 local prototype={type='inserter',tile_width=1,tile_height=1,supports_direction=true,items_to_place_this={{name='inserter'}},has_flag=function() return false end}
 prototypes={entity={inserter=prototype},item={glass={}}}
 local belt={valid=true,name='belt',type='transport-belt',force=force,position={x=2.5,y=0.5},unit_number=20}
 local producer={valid=true,name='furnace',type='furnace',force=force,position={x=-1.5,y=0.5},unit_number=10,get_recipe=function() return {name='glass',products={{type='item',name='glass'}}} end}
 local output={name='inserter',type='inserter',force=force,position={x=0.5,y=0.5},unit_number=1,direction=0,prototype=prototype,pickup_target=producer,drop_target=belt,drop_position={x=2.7,y=0.5}}
 local input={name='inserter',type='inserter',force=force,position={x=4.5,y=0.5},unit_number=2,direction=0,prototype=prototype,pickup_target=belt,drop_target=producer}
 local surface={name='nauvis',find_entities_filtered=function(args) return {args.position.x==0.5 and output or input} end}
 game={tick=120,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  local saved
  return {{set_stack=function() end,set_blueprint_entities=function(e) saved=e end,get_blueprint_entities=function() return saved end,get_blueprint_tiles=function() return {} end,cost_to_build={}}}
 end}
 defines={entity_status={}}
 ${blueprintSource}
 local request={operation='check',force='player',surface='nauvis',position={x=0,y=0},item='glass',outputs={},entities={
  {name='inserter',position={x=0.5,y=0.5},direction=0},{name='inserter',position={x=4.5,y=0.5},direction=0}
 }}
 local check=blueprint(request)
 assert(check.product_outputs_total==1 and #check.product_outputs==1)
 local connection=check.product_outputs[1]
 assert(connection.index==1 and connection.recipe=='glass' and connection.item=='glass')
 assert(connection.producer.unit_number==10 and connection.drop_target.unit_number==20 and connection.drop_position.x==2.7)
 producer.force={name='enemy'};assert(blueprint(request).product_outputs_total==0)
 producer.force=force;producer.get_recipe=function() return {name='sand',products={{type='item',name='sand'}}} end
 assert(blueprint(request).product_outputs_total==0)
 producer.get_recipe=function() return nil end;assert(blueprint(request).product_outputs_total==0)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('provider blueprint contracts accept omitted defaults and preserve strict operation boundaries', () => {
	const transcript = normalizeContext({
		messages: [],
		tools: [{ name: 'blueprint_operation', description: '', parameters: blueprintToolJsonSchema }]
	});
	const tool = transcript.messages.flatMap((message) =>
		message.role === 'system' ? (message.toolsAdded ?? []) : []
	)[0];
	assert.ok(tool);
	const validate = (arguments_: JsonObject) => {
		validateToolArguments(tool, {
			type: 'toolCall',
			name: tool.name,
			id: 'contract',
			arguments: arguments_
		});
		parseBlueprintToolRequest(arguments_);
	};
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
	for (const args of drafts) assert.throws(() => validate({ operation: 'create', args }));
	assert.throws(() =>
		validate({
			operation: 'program',
			args: {
				force: 'player',
				label: 'Program',
				program: 'return design',
				designId: 'a'.repeat(64)
			}
		})
	);
	assert.throws(() =>
		validate({
			operation: 'program',
			args: {
				force: 'player',
				label: 'Program',
				program: 'return design',
				operation: 'place'
			}
		})
	);
	assert.throws(() => validate({ operation: 'inspect', args: target }));
	assert.doesNotThrow(() =>
		validate({
			operation: 'inspect',
			args: {
				force: 'player',
				designId: 'a'.repeat(64),
				surface: 'nauvis',
				position: { x: 20, y: 20 }
			}
		})
	);
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
test('saved sections combine into one layout while preserving settings, tile offsets and wire endpoints', () => {
	const base = blueprintDesignSchema.parse(design);
	const section = blueprintDesignSchema.parse({
		force: 'player',
		label: 'Configured section',
		entities: [
			{
				name: 'fast-inserter',
				position: { x: 0.5, y: 0.5 },
				pickup_position: { x: 3, y: 0 },
				drop_position: { x: -2, y: 0 },
				use_filters: true,
				filters: [{ index: 1, name: 'iron-plate' }],
				wires: [[1, 1, 2, 1]]
			},
			{ name: 'medium-electric-pole', position: { x: 2.5, y: 0.5 } }
		],
		wires: [[1, 2, 2, 2]],
		tiles: [{ name: 'stone-path', position: { x: 0, y: 0 } }]
	});
	const before = JSON.stringify({ base, section });
	const combined = combineBlueprintDesigns(base, [{ design: section, offset: { x: -70, y: 32 } }]);
	assert.equal(combined.entities.length, 3);
	assert.deepEqual(combined.entities[1], {
		...section.entities[0],
		position: { x: -69.5, y: 32.5 },
		wires: [[2, 1, 3, 1]]
	});
	assert.deepEqual(combined.wires, [[2, 2, 3, 2]]);
	assert.deepEqual(combined.tiles, [{ name: 'stone-path', position: { x: -70, y: 32 } }]);
	assert.equal(JSON.stringify({ base, section }), before);
	assert.throws(
		() =>
			combineBlueprintDesigns(base, [
				{ design: { ...section, force: 'enemy' }, offset: { x: 0, y: 0 } }
			]),
		/another force/
	);
	assert.throws(
		() =>
			combineBlueprintDesigns(base, [
				{ design: { ...section, wires: [[1, 1, 3, 1]] }, offset: { x: 0, y: 0 } }
			]),
		/outside its section/
	);
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
		/Removed entity index 4.*3 entities.*1-based/
	);
	assert.throws(
		() =>
			reviseBlueprintDesign(saved, {
				...revision,
				entityChanges: [{ index: 4, changes: { direction: 8 } }]
			}),
		/Entity patch index 4.*3 entities.*1-based/
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
 local underground=prototype('underground-belt',1);underground.max_underground_distance=5
 local furnace=prototype('furnace',3)
 local pole=prototype('electric-pole',1)
 pole.get_max_wire_distance=function(quality) assert(quality=='normal');return 17 end
 pole.get_supply_area_distance=function(quality) assert(quality=='normal');return 4 end
 local box=prototype('container',3);box.tile_height=1;box.supports_direction=false
 prototypes={entity={plant=plant,inserter=inserter,belt=belt,ug=underground,other_ug=underground,box=box,furnace=furnace,pole=pole}}
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
 ${blueprintSource}
 defines={wire_connector_id={}}
 local catalog=blueprint{operation='catalog',force='player',names={'plant','furnace','pole'}}
 assert(catalog.entities[1].recipe_settable and not catalog.entities[2].recipe_settable)
 assert(catalog.entities[3].max_wire_distance==17 and catalog.entities[3].supply_area_distance==4)
 assert(catalog.entities[2].center_offset.x==0.5 and catalog.entities[2].center_offset.y==0.5)
 local aligned,alignment_error=pcall(blueprint,{operation='create',force='player',label='Misaligned furnace',entities={
  {name='furnace',position={x=2,y=2},direction=0},
  {name='furnace',position={x=8,y=2},direction=0}
 }})
 assert(not aligned and alignment_error:match('Entity 1 furnace') and alignment_error:match('Entity 2 furnace') and alignment_error:match('integer %+ 0.5'))
 local configured,recipe_error=pcall(blueprint,{operation='create',force='player',label='Furnace recipe',entities={
  {name='furnace',position={x=2.5,y=2.5},direction=0,recipe='iron-plate'}
 }})
 assert(not configured and recipe_error:match('Entity 1 furnace') and recipe_error:match('Remove recipe'))
 local typed,type_error=pcall(blueprint,{operation='create',force='player',label='Retained underground type',entities={
  {name='belt',position={x=0.5,y=0.5},type='input'}
 }})
 assert(not typed and type_error:match('Entity 1 belt') and type_error:match('type=nil'))
 local untyped,missing_type_error=pcall(blueprint,{operation='create',force='player',label='Missing underground type',entities={
  {name='ug',position={x=0.5,y=0.5}}
 }})
 assert(not untyped and missing_type_error:match('Entity 1 ug') and missing_type_error:match('type="input"'))
 local clear,collision_error=pcall(blueprint,{operation='create',force='player',label='Two conflicts',entities={
  {name='belt',position={x=0.5,y=0.5},direction=0},
  {name='pole',position={x=0.5,y=0.5},direction=0},
  {name='belt',position={x=2.5,y=0.5},direction=0},
  {name='pole',position={x=2.5,y=0.5},direction=0}
 }})
 assert(not clear and collision_error:match('index 2 pole') and collision_error:match('index 4 pole'))
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
  assert(#result.warnings==2 and result.warnings[1]:match('Entity 1 plant has no recipe') and result.warnings[2]:match('Entity 5 plant has no recipe'))
  local result=blueprint{operation='create',force='player',label='Custom',entities={
   entity('plant',2.5,0.5,0),entity('inserter',2.5,2.5,0,0.8),entity('belt',2.5,3.5,4)
  }}
  assert(result.inserter_transfers[1].drop_belt_side=='left')
  local single_lane=blueprint{operation='create',force='player',label='One lane',entities={
   entity('inserter',2.5,2.5,0),entity('belt',2.5,3.5,4),entity('belt',3.5,3.5,4),
   entity('inserter',4.5,2.5,0),entity('belt',4.5,3.5,4)
  }}
  assert(#single_lane.warnings==1 and single_lane.warnings[1]:match('7.5 items/s'))
  local function path_design(label,tail)
   local list={entity('plant',2.5,0.5,0),entity('inserter',2.5,2.5,0),entity('belt',2.5,3.5,4)}
   for _,e in ipairs(tail) do list[#list+1]=e end
   return blueprint{operation='create',force='player',label=label,entities=list}.inserter_transfers[1].planned_belt_path
  end
  local entrance=entity('ug',4.5,4.5,4);entrance.type='input'
  local exit=entity('ug',8.5,4.5,4);exit.type='output'
  local path=path_design('Turn and tunnel',{entity('belt',3.5,3.5,8),entity('belt',3.5,4.5,4),entrance,exit,entity('belt',9.5,4.5,0)})
  assert(path.status=='external' and path.length==6 and path.terminal_entity==8)
  local next_point=point(9.5,3.5);assert(path.next_position.x==next_point.x and path.next_position.y==next_point.y)
  local loop=path_design('Loop',{entity('belt',3.5,3.5,8),entity('belt',3.5,4.5,12),entity('belt',2.5,4.5,0)})
  assert(loop.status=='loop' and loop.length==4)
  local opposed=path_design('Opposed',{entity('belt',3.5,3.5,12)})
  assert(opposed.status=='opposed' and opposed.terminal_entity==3 and opposed.next_entity==4)
  entrance=entity('ug',3.5,3.5,4);entrance.type='input'
  exit=entity('other_ug',7.5,3.5,4);exit.type='output'
  assert(path_design('Mixed tunnel',{entrance,exit}).status=='unpaired')
  exit=entity('ug',3.5,3.5,4);exit.type='output'
  assert(path_design('Into exit',{exit}).status=='underground_exit')
  local isolated=blueprint{operation='create',force='player',label='External',entities={entity('inserter',2.5,2.5,0)}}
  assert(not isolated.inserter_transfers[1].pickup_entity and not isolated.inserter_transfers[1].drop_entity)
 end
 prototypes.entity.small=prototype('assembling-machine',1)
 prototypes.entity.small.crafting_categories={crafting=true}
 prototypes.recipe={
  producer={products={{type='item',name='sand'}},ingredients={{type='item',name='stone'}}},
  consumer={products={{type='item',name='glass'}},ingredients={{type='item',name='sand'}}}
 }
 for name,recipe in pairs(prototypes.recipe) do game.forces.player.recipes[name]={enabled=true,categories={'crafting'},products=recipe.products,ingredients=recipe.ingredients} end
 local feed={
  {name='small',position={x=.5,y=.5},direction=0,recipe='producer'},
  {name='inserter',position={x=.5,y=1.5},direction=0},
  {name='small',position={x=-2.5,y=4.5},direction=0,recipe='consumer'},
  {name='inserter',position={x=-2.5,y=3.5},direction=0}
 }
 for x=-2.5,3.5 do feed[#feed+1]={name='belt',position={x=x,y=2.5},direction=4} end
 local gap=blueprint{operation='create',force='player',label='Upstream consumer gap',entities=feed}
 local found=false
 for _,warning in ipairs(gap.warnings or {}) do if warning:match('No planned sand producer reaches inserter 4') then found=true end end
 assert(found,'A consumer upstream of every producer needs a draft feed warning')
 prototypes.entity.automatic=prototype('furnace',1);prototypes.entity.automatic.crafting_categories={crafting=true}
 feed[1].name='automatic';feed[1].recipe=nil
 local automatic_gap=blueprint{operation='create',force='player',label='Automatic furnace feed',entities=feed}
 found=false
 for _,warning in ipairs(automatic_gap.warnings or {}) do if warning:match('No planned sand producer reaches inserter 4') then found=true end end
 assert(found,'Native automatic recipes must participate without an encoded recipe setting')
 feed[1].position.x=-3.5;feed[2].position.x=-3.5
 feed[#feed+1]={name='belt',position={x=-3.5,y=2.5},direction=4}
 local connected=blueprint{operation='create',force='player',label='Connected producer',entities=feed}
 for _,warning in ipairs(connected.warnings or {}) do assert(not warning:match('No planned sand producer'),'The corrected source feeds the consumer') end
 table.remove(feed,2);table.remove(feed,1)
 local external_feed=blueprint{operation='create',force='player',label='Existing supply',entities=feed}
 for _,warning in ipairs(external_feed.warnings or {}) do assert(not warning:match('No planned sand producer'),'Existing-world inputs need no invented producer') end
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
 script={active_mods={Smart_Inserters='2.1.0'}}
 settings={startup={['si-max-inserters-range']={value=3},['si-range-adder']={value='equal'},['si-range-technologies']={value=false}}}
 local reach_design={operation='create',force='player',label='Legal reach',entities={{name='inserter',position={x=0.5,y=0.5},direction=0,drop_position={x=0,y=3.2}}}}
 assert(blueprint(reach_design).kind=='blueprint')
 for _,distance in ipairs({4,10,14}) do
  reach_design.entities[1].drop_position.y=distance
  local valid,message=pcall(blueprint,reach_design)
  assert(not valid and message:match('configured Smart Inserters reach 3'))
 end
 settings.startup['si-range-technologies'].value=true
 game.forces.player.technologies={['si-unlock-range-1']={researched=true,prototype={hidden=false}}}
 reach_design.entities[1].drop_position.y=3.2
 assert(not pcall(blueprint,reach_design))
 reach_design.entities[1].drop_position.y=2.2
 assert(blueprint(reach_design).kind=='blueprint')
 script=nil
 defines={build_check_type={manual=1}}
 local force=game.forces.player;force.name='player';force.logistic_networks={}
 local charted=true
 force.is_chunk_charted=function() return charted end
 local surface={get_territory_for_chunk=function() return nil end,name='nauvis',is_chunk_generated=function() return true end,can_place_entity=function() return false end}
 surface.get_tile=function(at)
  assert(charted, 'No terrain reads outside explored area')
  return {name=at.x>0.5 and 'water' or 'grass-1'}
 end
 surface.find_entities_filtered=function(filter)
  if filter.type=='entity-ghost' or filter.type=='tile-ghost' then return {} end
  if filter.position then return {} end
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
 charted=true
 defines.build_check_type.ghost_revive=3
 -- Native manual checks can allow fast replacement where a ghost cannot be placed.
 surface.can_place_entity=function(check) return check.build_check_type==defines.build_check_type.manual end
 assert(not blueprint(inspection).ready,'Fast replacement is not ghost clearance')
 defines.build_check_type.blueprint_ghost=2;defines.inventory={hub_main=1}
 surface.platform={force=force,hub={get_inventory=function() return nil end}}
 local own_foundation=true;local native_allowed=true;local ghost_checks=0
 local tile='empty-space'
 surface.get_tile=function() return {name=tile} end
 surface.find_entities_filtered=function(filter)
  if filter.type=='tile-ghost' then
   assert(filter.force==nil)
   return own_foundation and tile=='empty-space' and {{ghost_name='space-platform-foundation',force=force,position={x=0.5,y=0.5}}} or {}
  end
  return {}
 end
 surface.can_place_entity=function(check)
  if check.build_check_type~=2 then return false end
  assert(check.name=='belt' and check.forced==false)
  ghost_checks=ghost_checks+1;return native_allowed
 end
 local waiting=blueprint(inspection)
 assert(waiting.ready and not waiting.construction.hub_stock_ready)
 own_foundation=false;local before_checks=ghost_checks
 assert(not blueprint(inspection).ready and ghost_checks==before_checks)
 own_foundation=true;native_allowed=false;assert(not blueprint(inspection).ready)
 surface.platform=nil;tile='water'
 surface.find_entities_filtered=function(filter)
  return filter.type=='tile-ghost' and {{ghost_name='landfill',force=force,position={x=0.5,y=0.5}}} or {}
 end
 native_allowed=true;assert(blueprint(inspection).ready)
 surface.find_entities_filtered=function(filter)
  return filter.type=='tile-ghost' and {{ghost_name='landfill',force={name='other'},position={x=0.5,y=0.5}}} or {}
 end
 assert(not blueprint(inspection).ready)
 surface.platform={force=force,hub={get_inventory=function() return nil end}}
 surface.find_entities_filtered=function(filter)
  return filter.type=='tile-ghost' and own_foundation and tile=='empty-space' and {{ghost_name='space-platform-foundation',force=force,position={x=0.5,y=0.5}}} or {}
 end
 native_allowed=true;tile='space-platform-foundation';before_checks=ghost_checks
 assert(not blueprint(inspection).ready and ghost_checks==before_checks)
 tile='empty-space'
 local created=0
 surface.count_entities_filtered=function() return 0 end
 surface.create_entity=function(input)
  assert(input.name=='entity-ghost' and input.inner_name=='belt')
  created=created+1
  return {valid=true,type='entity-ghost',ghost_name='belt',position=input.position}
 end
 script={raise_script_built=function() end}
 inspection.operation='place';inspection.expectedTick=100;inspection.expectedDesign='site'
 assert(blueprint(inspection).complete and created==1)
 own_foundation=false
 assert(not pcall(blueprint,inspection) and created==1)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('blueprint extensions retain exact built entities and configured ghosts without replacing conflicts', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',recipes={{enabled=true,products={{type='item',name='building'}}}},logistic_networks={},is_chunk_charted=function() return true end}
 local p={type='transport-belt',tile_width=1,tile_height=1,items_to_place_this={{name='building'}},has_flag=function() return false end}
 local inserter={type='inserter',tile_width=1,tile_height=1,items_to_place_this={{name='building'}},has_flag=function() return false end,inserter_pickup_position={x=0,y=-1},inserter_drop_position={x=0,y=1}}
 local box={type='assembling-machine',tile_width=1,tile_height=1,items_to_place_this={{name='building'}},has_flag=function() return false end}
 prototypes={entity={belt=p,inserter=inserter,box=box},item={iron={}}}
 local built={valid=true,name='belt',type='transport-belt',force=force,position={x=.5,y=.5},direction=4}
 local ghost={valid=true,name='entity-ghost',type='entity-ghost',ghost_name='inserter',force=force,position={x=2.5,y=.5},direction=0,bounding_box={{2,0},{3,1}}}
 local occupants={built,ghost};local created=0;local filters={{index=1,name='iron'}}
 local surface={name='nauvis',get_territory_for_chunk=function() return nil end,is_chunk_generated=function() return true end,get_tile=function() return {name='grass-1'} end}
 surface.find_entities_filtered=function(q)
  local result={}
  for _,e in ipairs(occupants) do
   local at=q.position and e.position.x==q.position.x and e.position.y==q.position.y
   local area=q.area and e.position.x>=q.area[1][1] and e.position.x<q.area[2][1] and e.position.y>=q.area[1][2] and e.position.y<q.area[2][2]
   if (at or area) and (not q.force or q.force==e.force) and (not q.type or q.type==e.type) then result[#result+1]=e end
  end
  return result
 end
 surface.count_entities_filtered=function(q) return #surface.find_entities_filtered(q) end
 surface.can_place_entity=function(q)
  for _,e in ipairs(occupants) do if e.position.x==q.position.x and e.position.y==q.position.y then return false end end
  return true
 end
 surface.create_entity=function(q)
  created=created+1
  local e={valid=true,name='entity-ghost',type='entity-ghost',ghost_name=q.inner_name,position=q.position,force=q.force,direction=q.direction,get_recipe=function() return nil end}
  occupants[#occupants+1]=e;return e
 end
 game={tick=100,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  local saved
  return {{set_stack=function() end,set_blueprint_entities=function(e) saved=e end,get_blueprint_entities=function() return saved end,get_blueprint_tiles=function() return {} end,cost_to_build={},
   create_blueprint=function() saved={{filters=filters,use_filters=true}};return {[1]=ghost} end}}
 end}
 defines={build_check_type={manual=1}};script={raise_script_built=function() end}
 ${blueprintSource}
 local request={operation='inspect',force='player',surface='nauvis',position={x=0,y=0},design='extension',entities={
  {name='belt',position={x=.5,y=.5},direction=4},
  {name='inserter',position={x=2.5,y=.5},direction=0,filters={{index=1,name='iron'}},use_filters=true},
  {name='box',position={x=4.5,y=.5},direction=0}
 }}
 local inspection=blueprint(request);assert(inspection.ready and inspection.retained_built==1 and inspection.retained_ghosts==1 and created==0)
 request.operation='place';request.expectedTick=100;request.expectedDesign='extension'
 local placed=blueprint(request);assert(placed.complete and placed.requested==1 and placed.placed==1 and placed.recipe_machines==1 and placed.unconfigured_machines==1 and created==1)
 local replay=blueprint(request);assert(replay.complete and replay.requested==0 and replay.placed==0 and replay.retained_ghosts==2 and created==1)
 built.direction=0;assert(not pcall(blueprint,request) and created==1);built.direction=4
 filters={};assert(not pcall(blueprint,request) and created==1);filters={{index=1,name='iron'}}
 ghost.force={name='other'};assert(not pcall(blueprint,request) and created==1);ghost.force=force
 surface.get_territory_for_chunk=function() return {get_segmented_units=function() return {{valid=true,prototype={name='small-demolisher'}}} end} end
 assert(not pcall(blueprint,request) and created==1)
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
		blueprintRowsSchema.safeParse({ ...rows, entityRows: [{ ...rows.entityRows[0], count: 1000 }] })
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
		Array(1001).fill(design.entities[0]),
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

test('ordinary construction tiles round-trip and obey native placement and site changes', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',recipes={{enabled=true,products={{type='item',name='landfill'}}}},logistic_networks={}}
 local charted=true;local allowed=true;local occupied=false;local built=false;local renamed=false;local created=0
 local matching_ghost=nil
 force.is_chunk_charted=function() return charted end
 local surface={get_territory_for_chunk=function() return nil end,name='nauvis',is_chunk_generated=function() return true end}
 surface.get_tile=function() return {name=built and 'landfill' or 'water',has_tile_ghost=function() return occupied end} end
 surface.find_entities_filtered=function() return matching_ghost and {matching_ghost} or {} end
 surface.can_place_entity=function(check)
  assert(check.name=='tile-ghost' and check.inner_name=='landfill' and check.force==force and check.forced==false)
  return allowed
 end
 surface.create_entity=function(check)
  assert(check.name=='tile-ghost' and check.inner_name=='landfill')
  created=created+1;occupied=true;return {valid=true}
 end
 defines={build_check_type={manual=1}};script={raise_script_built=function() end}
 prototypes={entity={},tile={landfill={can_be_part_of_blueprint=true,items_to_place_this={{name='landfill',count=1}}},water={can_be_part_of_blueprint=true}}}
 game={tick=100,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  local saved
  return {{set_stack=function() end,set_blueprint_entities=function() end,get_blueprint_entities=function() return {} end,
   set_blueprint_tiles=function(tiles) saved=tiles end,get_blueprint_tiles=function()
    if renamed then return {{name='water',position=saved[1].position}} end;return saved
   end,export_stack=function() return '0native' end,cost_to_build={{name='landfill',count=1}}}}
 end}
 ${blueprintSource}
 local request={operation='create',force='player',label='Landfill',entities={},tiles={{name='landfill',position={x=0,y=0}}}}
 assert(blueprint(request).kind=='blueprint')
 renamed=true;assert(not pcall(blueprint,request));renamed=false
 request.tiles[1].name='water';assert(not pcall(blueprint,request));request.tiles[1].name='landfill'
 request.operation='inspect';request.surface='nauvis';request.position={x=0,y=0};request.design='site'
 local guardian={valid=true,prototype={name='small-demolisher'}}
 local guarded=false
 surface.get_territory_for_chunk=function() if guarded then return {get_segmented_units=function() return {guardian} end} end end
 guarded=true
 local denied=blueprint(request);assert(not denied.ready and denied.blocked[1].territory.status=='guarded')
 request.operation='place';request.expectedTick=game.tick;request.expectedDesign=request.design
 local ok,err=pcall(blueprint,request);assert(not ok and err:find('placement forbidden',1,true) and created==0)
 guarded=false;request.operation='inspect'
 assert(blueprint(request).ready)
 guarded=true;request.operation='place'
 assert(not pcall(blueprint,request) and created==0,'A guardian arriving after inspection must block placement')
 guardian.valid=false;request.operation='inspect';assert(blueprint(request).ready)
 guarded=false
 surface.get_territory_for_chunk=nil
 assert(not blueprint(request).ready,'Unavailable territory APIs must not permit placement')
 surface.get_territory_for_chunk=function() return nil end
 assert(blueprint(request).ready)
 allowed=false;assert(not blueprint(request).ready);allowed=true
 charted=false;assert(not blueprint(request).ready);charted=true
 occupied=true;assert(not blueprint(request).ready);occupied=false
 occupied=true;matching_ghost={force=force,ghost_name='landfill',position={x=0.5,y=0.5}}
 local reused=blueprint(request);assert(reused.ready and reused.tiles_pending==0 and reused.cost[1].count==1)
 request.operation='place';request.expectedTick=100;request.expectedDesign='site'
 local replay=blueprint(request);assert(replay.complete and replay.placed_tiles==0 and created==0)
 request.operation='inspect'
 matching_ghost.force={name='other'};assert(not blueprint(request).ready)
 matching_ghost.force=force;matching_ghost.ghost_name='concrete';assert(not blueprint(request).ready)
 matching_ghost.ghost_name='landfill';matching_ghost.position.x=1.5;assert(not blueprint(request).ready)
 matching_ghost=nil;occupied=false
 built=true;assert(#blueprint(request).cost==0);built=false
 request.operation='place';request.expectedTick=100;request.expectedDesign='site'
 allowed=false;assert(not pcall(blueprint,request) and created==0);allowed=true
 assert(blueprint(request).placed_tiles==1 and created==1)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('native placement inspection identifies pole gaps and preserves uncertainty outside charted evidence', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local charted=true
 local force={name='player',logistic_networks={},recipes={{enabled=true,products={{type='item',name='building'}}}},is_chunk_charted=function() return charted end}
 local function proto(kind,width)
  return {type=kind,tile_width=width,tile_height=width,items_to_place_this={{name='building',count=1}},has_flag=function() return false end}
 end
 local plant=proto('assembling-machine',3);plant.electric_energy_source_prototype={}
 local pole=proto('electric-pole',1)
 pole.get_max_wire_distance=function() return 9 end;pole.get_supply_area_distance=function() return 4 end
 prototypes={entity={plant=plant,pole=pole}}
 local source={type='electric-pole',name='pole',quality={name='normal'},position={x=0.5,y=0.5},electric_network={parent_network={flow_last_tick={maximum_production=1,accumulator_energy=0}}}}
 local surface={get_territory_for_chunk=function() return nil end,name='nauvis',can_place_entity=function() return true end,is_chunk_generated=function() return true end}
 surface.find_entities_filtered=function(q)
  if q.type~='electric-pole' then return {} end
  local dx,dy=source.position.x-q.position.x,source.position.y-q.position.y
  return dx*dx+dy*dy<=q.radius*q.radius and {source} or {}
 end
 game={tick=100,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  local saved
  return {{set_stack=function() end,set_blueprint_entities=function(e) saved=e end,get_blueprint_entities=function() return saved end,get_blueprint_tiles=function() return {} end,export_stack=function() return '0native' end,cost_to_build={{name='building',count=2}}}}
 end}
 defines={build_check_type={manual=1}}
 ${blueprintSource}
 local request={operation='inspect',force='player',surface='nauvis',position={x=0,y=0},label='Powered module',design='inspection',entities={
  {name='plant',position={x=20.5,y=0.5},direction=0},
  {name='pole',position={x=20.5,y=4.5},direction=0}
 }}
 local gap=blueprint(request)
 assert(gap.ready and gap.power.checked and gap.power.uncovered_total==0 and gap.power.unconnected_total==1)
 assert(gap.power.unconnected_entities[1]==1)
 request.entities[3]={name='pole',position={x=8.5,y=0.5},direction=0}
 request.entities[4]={name='pole',position={x=16.5,y=0.5},direction=0}
 local connected=blueprint(request)
 assert(connected.power.checked and connected.power.uncovered_total==0 and connected.power.unconnected_total==0)
 request.entities={{name='plant',position={x=2.5,y=0.5},direction=0}}
 local existing=blueprint(request)
 assert(existing.power.checked and existing.power.unconnected_total==0 and existing.power.uncovered_total==0,'Existing power must work without adding poles')
 force.is_chunk_charted=function(_,chunk) return chunk.x>=0 end
 local find=surface.find_entities_filtered
 surface.find_entities_filtered=function(q)
  local rows=find(q)
  if q.type=='electric-pole' then rows[#rows+1]={type='electric-pole',name='pole',quality={name='normal'},position={x=-32.5,y=0.5}} end
  return rows
 end
 assert(blueprint(request).power.checked,'A known powered path must not be invalidated by unrelated uncharted poles')
 force.is_chunk_charted=function() return charted end
 charted=false;assert(not blueprint(request).power.checked,'Uncharted evidence cannot prove an absent power source')
 charted=true;surface.find_entities_filtered=find
 plant.collision_box={left_top={x=-1.4,y=-1.4},right_bottom={x=1.4,y=1.4}}
 local extender=proto('electric-pole',1)
 extender.get_max_wire_distance=function() return 1 end;extender.get_supply_area_distance=function() return 2 end
 prototypes.entity['power-propagation-invisible-pole-3']=extender
 script={active_mods={['power-propagation']='1.6.0'}}
 settings={startup={['power-propagation-through-powered-buildings']={value=true}}}
 request.entities={
  {name='plant',position={x=5.5,y=0.5},direction=0},
  {name='plant',position={x=9.5,y=0.5},direction=0},
  {name='plant',position={x=13.5,y=0.5},direction=0}
 }
 local propagated=blueprint(request)
 assert(propagated.power.checked and propagated.power.unconnected_total==0 and propagated.power.uncovered_total==0,'Planned powered buildings extend the active mod network')
 assert(propagated.entities==3,'Extenders model normal mod behavior without exporting hidden poles')
 settings.startup['power-propagation-through-powered-buildings'].value=false
 assert(blueprint(request).power.uncovered_total>0,'Disabled propagation must not prove coverage')
 settings.startup['power-propagation-through-powered-buildings'].value=true
 request.entities[3].position.x=25.5
 assert(blueprint(request).power.unconnected_total==1,'A disconnected planned extender does not supply itself')
 script.active_mods['power-propagation']='1.6.1'
 assert(not blueprint(request).power.checked,'An unreviewed mod version retains uncertainty about reported gaps')
 script.active_mods={}
 assert(blueprint(request).power.uncovered_total>0,'Absent mods must not imply propagation')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('native export warns about missing, distant and competing underground partners', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',recipes={{enabled=true,products={{type='item',name='underground-belt'}}}}}
 local prototype={type='underground-belt',tile_width=1,tile_height=1,supports_direction=true,max_underground_distance=5,items_to_place_this={{name='underground-belt'}},has_flag=function() return false end}
 prototypes={entity={['underground-belt']=prototype}}
 game={forces={player=force},create_inventory=function()
  local saved
  return {{set_stack=function() end,set_blueprint_entities=function(entities) saved=entities end,
   get_blueprint_entities=function() return saved end,get_blueprint_tiles=function() return {} end,
   export_stack=function() return '0native' end,cost_to_build={}}}
 end}
 ${blueprintSource}
 local function belt(x,kind) return {name='underground-belt',position={x=x,y=0.5},direction=4,type=kind} end
 local request={operation='create',force='player',label='Connection',entities={belt(0.5,'input'),belt(5.5,'output')}}
 assert(not blueprint(request).warnings)
 request.entities={belt(0.5,'input')}
 local missing=blueprint(request).warnings
 assert(#missing==1 and missing[1]:find('entity 1') and missing[1]:find('paired output'))
 request.entities={belt(0.5,'input'),belt(6.5,'output')}
 assert(#blueprint(request).warnings==2)
 request.entities={belt(0.5,'input'),belt(2.5,'input'),belt(5.5,'output')}
 local competing=blueprint(request).warnings
 assert(#competing==1 and competing[1]:find('entity 1'))
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
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

test('build checks identify current ingredient shortages and retain native craft counters', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',recipes={{enabled=true,products={{type='item',name='plant'}}}}}
 local prototype={type='assembling-machine',tile_width=3,tile_height=3,supports_direction=true,items_to_place_this={{name='plant'}},has_flag=function() return false end}
 prototypes={entity={plant=prototype},item={battery={}}}
 defines={inventory={crafter_input=1},entity_status={item_ingredient_shortage=1,fluid_ingredient_shortage=2,full_output=3}}
 local amounts={copper=0,iron=2};local acid=1.5
 local recipe={name='battery',ingredients={{type='item',name='copper',amount=1},{type='item',name='iron',amount=2},{type='fluid',name='acid',amount=2}}}
 local machine={name='plant',type='assembling-machine',force=force,position={x=.5,y=.5},unit_number=42,direction=0,prototype=prototype,status=1,products_finished=1000,
  get_recipe=function() return recipe,{name='uncommon'} end,is_crafting=function() return false end,is_connected_to_electric_network=function() return true end,
  get_inventory=function(id) assert(id==1);return {get_item_count=function(q) assert(q.quality=='uncommon');return amounts[q.name] end} end,
  get_fluid_count=function(name) assert(name=='acid');return acid end}
 local surface={name='nauvis',find_entities_filtered=function() return {machine} end}
 game={tick=120,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  local saved;return {{set_stack=function() end,set_blueprint_entities=function(e) saved=e end,get_blueprint_entities=function() return saved end,get_blueprint_tiles=function() return {} end,cost_to_build={}}}
 end}
 ${blueprintSource}
 local request={operation='check',force='player',surface='nauvis',position={x=0,y=0},item='battery',outputs={},entities={{name='plant',position={x=.5,y=.5},direction=0}}}
 local check=blueprint(request);local row=check.machines[1]
 assert(check.constructed==1 and check.faults_total==0 and row.unit_number==42 and row.products_finished==1000)
 assert(row.missing_inputs.total==2 and #row.missing_inputs.ingredients==2)
 assert(row.missing_inputs.ingredients[1].name=='copper' and row.missing_inputs.ingredients[1].available==0 and row.missing_inputs.ingredients[1].quality=='uncommon')
 assert(row.missing_inputs.ingredients[2].name=='acid' and row.missing_inputs.ingredients[2].available==1.5 and not row.missing_inputs.ingredients[2].quality)
 machine.status=2;amounts.copper=1;machine.products_finished=1001
 row=blueprint(request).machines[1];assert(row.products_finished==1001 and row.missing_inputs.total==1)
 machine.status=3;machine.get_inventory=function() error('Full outputs do not need an input diagnosis') end
 row=blueprint(request).machines[1];assert(row.status=='full_output' and not row.missing_inputs)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});

test('build verification includes working and stalled mining drills without treating them as crafters', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 local force={name='player',recipes={{enabled=true,products={{type='item',name='drill'}}}}}
 local prototype={type='mining-drill',tile_width=3,tile_height=3,supports_direction=true,items_to_place_this={{name='drill'}},has_flag=function() return false end}
 prototypes={entity={drill=prototype},item={stone={}}}
 local drop={valid=true,name='belt',unit_number=2,force=force,position={x=2.5,y=.5}}
 local drilled={name='drill',type='mining-drill',force=force,position={x=.5,y=.5},unit_number=1,direction=4,prototype=prototype,status=1,mining_target={valid=true,name='stone',position={x=.5,y=.5},amount=100},drop_target=drop,drop_position=drop.position,is_connected_to_electric_network=function() return true end}
 local surface={name='nauvis',find_entities_filtered=function() return {drilled} end}
 game={tick=120,forces={player=force},surfaces={nauvis=surface},create_inventory=function()
  local saved;return {{set_stack=function() end,set_blueprint_entities=function(e) saved=e end,get_blueprint_entities=function() return saved end,get_blueprint_tiles=function() return {} end,cost_to_build={}}}
 end}
 defines={entity_status={working=1,no_minable_resources=2}}
 ${blueprintSource}
 local request={operation='check',force='player',surface='nauvis',position={x=0,y=0},item='stone',outputs={},entities={{name='drill',position={x=.5,y=.5},direction=4}}}
 local check=blueprint(request)
 assert(check.constructed==1 and check.machines_total==1 and check.machine_status_counts.working==1)
 assert(check.machines[1].powered and check.machines[1].type=='mining-drill' and check.machines[1].mining_target.amount==100)
 assert(check.machines[1].drop_target.unit_number==2 and check.machines[1].crafting==nil)
 drilled.status=2;drilled.mining_target=nil;drop.force={name='enemy'}
 check=blueprint(request)
 assert(check.machine_status_counts.no_minable_resources==1 and not check.machines[1].mining_target and not check.machines[1].drop_target)
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
	lua.lua_close(state);
});
