import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blueprintDesignSchema } from '../src/lib/blueprints';
import { runBlueprintProgram } from '../src/lib/server/blueprint-program';

const base = blueprintDesignSchema.parse({ force: 'player', label: 'Program' });
test('layout programs generate rows and revise real settings without changing the source draft', async () => {
	const saved = blueprintDesignSchema.parse({
		...base,
		entities: [
			{
				name: 'fast-inserter',
				position: { x: 0.5, y: 0.5 },
				filters: [{ index: 1, name: 'iron-plate' }],
				use_filters: true,
				pickup_position: { x: 0, y: -2 },
				drop_position: { x: 0, y: 2 }
			}
		]
	});
	const output = await runBlueprintProgram(
		"design.entities[1].position.x=2.5; for x=0,7 do table.insert(design.entities,{name='transport-belt',position={x=x+.5,y=3.5},direction=4}) end; return design",
		saved
	);
	assert.equal(output.entities.length, 9);
	assert.equal(output.entities[0]?.position.x, 2.5);
	assert.deepEqual(output.entities[0]?.filters, saved.entities[0]?.filters);
	assert.deepEqual(output.entities[0]?.pickup_position, saved.entities[0]?.pickup_position);
	assert.equal(saved.entities[0]?.position.x, 0.5);
	assert.equal(output.entities.at(-1)?.position.x, 7.5);
});
test('layout programs cannot access host capabilities, change force or bypass blueprint bounds', async () => {
	await assert.rejects(
		runBlueprintProgram(
			"assert(os==nil and io==nil and package==nil and debug==nil and require==nil and load==nil); return {force='enemy',label='No',entities={}}",
			base
		),
		/cannot change its force/
	);
	await assert.rejects(
		runBlueprintProgram(
			"for i=1,1001 do design.entities[i]={name='transport-belt',position={x=.5,y=.5}} end; return design",
			base
		),
		/Invalid generated layout/
	);
	await assert.rejects(
		runBlueprintProgram(
			"design.entities[1]={name='belt',position={x=0.25,y=0}};return design",
			base
		),
		/Invalid generated layout/
	);
	await assert.rejects(runBlueprintProgram('while true do end', base), /instructions/);
	await assert.rejects(
		runBlueprintProgram("local s='abcdefgh';for i=1,30 do s=s..s end;return design", base),
		/string exceeds/
	);
	await assert.rejects(
		runBlueprintProgram("string.rep('x',1000000000);return design", base),
		/nil value/
	);
	await assert.rejects(
		runBlueprintProgram('design.entities[1]=design;return design', base),
		/cyclic table/
	);
	await assert.rejects(runBlueprintProgram('return function() end', base), /only data/);
});

test('a layout program clears underground settings when converting a belt without altering the saved draft', async () => {
	const saved = blueprintDesignSchema.parse({
		...base,
		entities: [{ name: 'underground-belt', type: 'input', position: { x: 0.5, y: 0.5 } }]
	});
	const result = await runBlueprintProgram(
		"design.entities[1].name='transport-belt'; design.entities[1].type=nil; return design",
		saved
	);
	assert.equal(result.entities[0]?.name, 'transport-belt');
	assert.equal(result.entities[0]?.type, undefined);
	assert.equal(saved.entities[0]?.type, 'input');
});
