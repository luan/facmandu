import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('native startup waits for sustained delivery and keeps fluid destinations independent', () => {
	const result = spawnSync('lua', ['-'], {
		encoding: 'utf8',
		input: `
 local observe=dofile('src/lib/server/factory-trial-startup.lua')
 local function port(n,rate,kind,name) return {delivered=n,perMinute=rate,kind=kind or 'item',name=name or 'circuit'} end
 local h={}
 assert(not observe(h,0,{port(0,120)}))
 assert(not observe(h,3599,{port(120,120)}),'An initial burst is not a full minute of delivery')
 local ready,rates=observe(h,3600,{port(120,120)})
 assert(ready and rates[1].perMinute==120)
 assert(not observe(h,7200,{port(120,120)}),'A stopped output must not retain a previous passing window')
 local items={}
 observe(items,0,{port(0,60),port(0,60)},true)
 assert(observe(items,3600,{port(120,60),port(0,60)},true),'Provider chests share one product target')
 local fluids={}
 observe(fluids,0,{port(0,60,'fluid','water'),port(0,60,'fluid','water')})
 assert(not observe(fluids,3600,{port(120,60,'fluid','water'),port(0,60,'fluid','water')}),'One supplied fluid destination must not hide a disconnected one')
 local products={}
 observe(products,0,{port(0,60,'item','a'),port(0,60,'item','b')})
 assert(not observe(products,3600,{port(120,60,'item','a'),port(0,60,'item','b')}))
 for tick=7260,18000,60 do observe(h,tick,{port(120,120)}) end
 assert(#h<=61,'Only the rolling minute is retained')
 assert(not pcall(observe,h,18060,{port(0,120)}),'Counter resets cannot qualify output')
 `
	});
	assert.equal(result.status, 0, result.stderr);
});
