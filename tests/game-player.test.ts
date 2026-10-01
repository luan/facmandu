import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertGameAction, gamePlayerSchema } from '../src/lib/server/game-player';
import { gameAssistantSchema } from '../src/lib/server/server-files';

test('in-game actions require the configured sponsor, player permission and own force', () => {
	const config = gameAssistantSchema.parse({ enabled: true, ownerId: 'owner' });
	const player = gamePlayerSchema.parse({
		name: 'Alice',
		force: 'alpha',
		surface: 'nauvis',
		position: { x: 1, y: 2 },
		admin: false,
		connected: true
	});
	assert.throws(() => assertGameAction(config, 'owner', player, 'alpha'), /not enabled/);
	assert.throws(
		() => assertGameAction({ ...config, actions: 'admins' }, 'owner', player, 'alpha'),
		/not enabled/
	);
	assert.doesNotThrow(() =>
		assertGameAction({ ...config, actions: 'admins' }, 'owner', { ...player, admin: true }, 'alpha')
	);
	const allowed = { ...config, actions: 'allowlist' as const, players: ['Alice'] };
	assert.doesNotThrow(() => assertGameAction(allowed, 'owner', player, 'alpha'));
	assert.throws(() => assertGameAction(allowed, 'owner', player, 'other'), /own force/);
	assert.throws(() => assertGameAction(allowed, 'other-owner', player, 'alpha'), /disabled/);
	assert.throws(
		() => assertGameAction({ ...allowed, enabled: false }, 'owner', player, 'alpha'),
		/disabled/
	);
	assert.throws(
		() => assertGameAction({ ...allowed, players: ['alice'] }, 'owner', player, 'alpha'),
		/not enabled/
	);
	assert.equal(gamePlayerSchema.safeParse({ ...player, connected: false }).success, false);
});
