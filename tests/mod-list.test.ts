import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModList } from '../src/lib/mod-list';

test('exports exact custom versions, explicit bundled choices, and one implicit base', () => {
	const mods = [
		{ name: 'example', version: '1.2.3', enabled: true },
		{ name: 'disabled', version: '1.0.0', enabled: false },
		{ name: 'base', version: '2.0.1', enabled: false },
		{ name: 'space-age', version: '2.0.1', enabled: false },
		{ name: 'quality', version: '2.0.1', enabled: true }
	];
	assert.deepEqual(createModList(mods), {
		mods: [
			{ name: 'base', enabled: true },
			{ name: 'example', enabled: true, version: '1.2.3' },
			{ name: 'quality', enabled: true },
			{ name: 'space-age', enabled: false }
		]
	});
	assert.deepEqual(createModList(mods), createModList(mods.toReversed()));
});
