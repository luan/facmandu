import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validPrototypeIcon } from '../src/lib/server/prototype-icons';

test('prototype icon paths accept exact Factorio names and reject path escapes', () => {
	assert.equal(validPrototypeIcon('technology', 'electronics'), true);
	assert.equal(validPrototypeIcon('item', 'Copper plate'), true);
	assert.equal(validPrototypeIcon('recipe', 'mod.item-1'), true);
	for (const name of ['', '.', '..', '../secret', 'a/b', 'a\\b', 'bad\nname', 'x'.repeat(201)]) {
		assert.equal(validPrototypeIcon('item', name), false, name);
	}
	assert.equal(validPrototypeIcon('script-output', 'electronics'), false);
});
