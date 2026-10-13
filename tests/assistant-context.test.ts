import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantContextLimit, assistantContextTokens } from '../src/lib/assistant-context';

test('context occupancy includes cached tokens without adding previous requests', () => {
	const usage = { input: 100, output: 50, cacheRead: 8000, cacheWrite: 1000, totalTokens: 9150 };
	assert.equal(assistantContextTokens(usage), 9150);
	assert.equal(assistantContextTokens({ ...usage, totalTokens: 0 }), 9150);
	assert.equal(
		assistantContextTokens({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }),
		null
	);
});

test('automatic compaction headroom follows the active model including small and unknown windows', () => {
	assert.equal(assistantContextLimit('large', 128000, 32000).reserve, 20000);
	assert.equal(assistantContextLimit('small-output', 128000, 4096).reserve, 4096);
	assert.equal(assistantContextLimit('million', 1048560, 393216).reserve, 20000);
	assert.equal(assistantContextLimit('small-window', 12000, 8192).reserve, 4000);
	assert.equal(assistantContextLimit('unknown', 0, 0).window, 0);
	assert.equal(assistantContextLimit('fresh', 128000, 8192).tokens, null);
});

test('factory working context compacts at 64k without changing the model window', () => {
	const large = assistantContextLimit('sol', 500000, 32000, 64000);
	assert.equal(large.window, 500000);
	assert.equal(large.window - large.reserve, 64000);
	assert.equal(assistantContextLimit('small', 12000, 8192, 64000).reserve, 4000);
});
