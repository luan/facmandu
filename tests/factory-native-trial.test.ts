import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { factoryTrialContextSchema } from '../src/lib/server/factory-native-trial';

const context = {
	technologies: { automation: { researched: true, level: 1 } },
	recipes: { defaultEnabled: true, exceptions: { locked: true }, count: 2 },
	properties: { pressure: 4000 },
	runtimeSettings: { setting: true },
	modifiers: { inserter_stack_size_bonus: 1 },
	mods: { base: '2.1.21' },
	daytime: 0.5,
	freezeDaytime: false,
	solarPowerMultiplier: 1
};
test('native force snapshots fit the RCON protocol without losing recipe state or modifiers', () => {
	const encoded = deflateSync(JSON.stringify(context)).toString('base64');
	assert.deepEqual(factoryTrialContextSchema.parse(encoded), context);
	assert.equal(
		factoryTrialContextSchema.safeParse({ ...context, modifiers: { researched: 1 } }).success,
		false
	);
});
test('oversized or corrupt native snapshots cannot be accepted for qualification', () => {
	assert.throws(() => factoryTrialContextSchema.parse('invalid compressed data'));
	const encoded = deflateSync(Buffer.alloc(8 * 1024 * 1024 + 1, 32)).toString('base64');
	assert.throws(() => factoryTrialContextSchema.parse(encoded), /buffer|larger|size|length/u);
});
