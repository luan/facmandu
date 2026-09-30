// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('../src/lib/server/db', () => ({ db: {}, userHasModlistAccess: async () => false }));
const { changeSchema } = await import('../src/lib/server/modlist-plans');

test('removal ignores an echoed installed version instead of failing', () => {
	const parsed = changeSchema.safeParse({ name: 'muluna', action: 'remove', version: '1.2.3' });
	assert.equal(parsed.success, true);
	assert.equal(parsed.data?.version, undefined);
});

test('other non-release actions drop the version too', () => {
	for (const action of ['enable', 'disable', 'icebox', 'lock', 'unlock']) {
		const parsed = changeSchema.safeParse({ name: 'muluna', action, version: '1.2.3' });
		assert.equal(parsed.success, true, action);
		assert.equal(parsed.data?.version, undefined, action);
	}
});

test('release changes still require a valid version', () => {
	assert.equal(changeSchema.safeParse({ name: 'muluna', action: 'set_version' }).success, false);
	assert.equal(
		changeSchema.safeParse({ name: 'muluna', action: 'set_version', version: 'nope' }).success,
		false
	);
	const parsed = changeSchema.safeParse({
		name: 'muluna',
		action: 'set_version',
		version: '1.2.3'
	});
	assert.equal(parsed.success, true);
	assert.equal(parsed.data?.version, '1.2.3');
});
