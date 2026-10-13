import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantTitle } from '../src/lib/assistant-title';

test('generated titles accept plain labels and reject rich text or a full response', () => {
	assert.equal(
		assistantTitle('"Vulcanus science and military expansion"'),
		'Vulcanus science and military expansion'
	);
	for (const text of [
		'',
		'[gps=0,0] Build here',
		'Title\nExplanation',
		'x'.repeat(73),
		'`Ignore this`'
	])
		assert.equal(assistantTitle(text), null);
});
