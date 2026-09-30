import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type DesiredMod,
	planServerMods,
	type ServerModState
} from '../src/lib/server/server-mod-plan';

const mod = (name: string, overrides: Partial<DesiredMod> = {}): DesiredMod => ({
	name,
	enabled: true,
	icebox: false,
	version: '1.2.3',
	factorioVersion: '2.0',
	dependencies: '[]',
	...overrides
});
const state = (overrides: Partial<ServerModState> = {}): ServerModState => ({
	mods: [],
	installed: {},
	factorioVersion: '2.0.72',
	...overrides
});

test('reviews exact versions, toggles, and extra mods while preserving bundled choices', () => {
	const desired = [mod('new'), mod('off'), mod('base'), mod('later', { icebox: true })];
	const current = state({
		mods: [
			{ name: 'off', enabled: false },
			{ name: 'old', enabled: true },
			{ name: 'base', enabled: true },
			{ name: 'space-age', enabled: true }
		],
		installed: { off: ['1.2.3'], old: ['1.0.0'] }
	});
	const plan = planServerMods(desired, current, '2.0');
	assert.deepEqual(plan.problems, []);
	assert.deepEqual(plan.changes, [
		{ kind: 'install', name: 'new', version: '1.2.3', previous: [] },
		{ kind: 'enable', name: 'off' },
		{ kind: 'disable', name: 'old' }
	]);
	assert.equal(
		plan.hash,
		planServerMods(desired.toReversed(), { ...current, mods: current.mods.toReversed() }, '2.0')
			.hash
	);
});

test('review hashes change when versions or target Factorio change', () => {
	const desired = [mod('example')];
	const current = state({
		mods: [{ name: 'example', enabled: true }],
		installed: { example: ['1.2.3'] }
	});
	const match = planServerMods(desired, current, '2.0');
	assert.deepEqual(match.changes, []);
	const mismatch = planServerMods(
		desired,
		{ ...current, installed: { example: ['2.0.0'] } },
		'2.0'
	);
	assert.deepEqual(mismatch.changes, [
		{ kind: 'install', name: 'example', version: '1.2.3', previous: ['2.0.0'] }
	]);
	assert.notEqual(match.hash, mismatch.hash);
	assert.notEqual(match.hash, planServerMods(desired, current, '2.1').hash);
});

test('blocks incomplete metadata, incompatible game versions, missing dependencies and conflicts', () => {
	const plan = planServerMods(
		[
			mod('unknown', { version: null, dependencies: null }),
			mod('dependent', { dependencies: JSON.stringify(['required >= 1.0.0', '!incompatible']) }),
			mod('incompatible')
		],
		state(),
		'2.1'
	);
	for (const problem of [
		'No known version for unknown',
		'Dependency metadata is missing for unknown',
		'Missing dependency: required',
		'dependent conflicts with incompatible'
	])
		assert.ok(plan.problems.includes(problem), problem);
	assert.ok(plan.problems.some((problem) => problem.includes('targets Factorio 2.1')));
});

test('enables required bundled mods and checks their version constraints', () => {
	const desired = [mod('needs-quality', { dependencies: '["quality >= 2.0.80"]' })];
	const plan = planServerMods(
		desired,
		state({ mods: [{ name: 'quality', enabled: false }] }),
		'2.0'
	);
	assert.ok(plan.changes.some((change) => change.kind === 'enable' && change.name === 'quality'));
	assert.ok(plan.problems.includes('needs-quality requires quality >= 2.0.80'));
});

test('validates conflicts against the final bundled selection and honors explicit disabled choices', () => {
	const current = state({
		mods: [
			{ name: 'quality', enabled: false },
			{ name: 'space-age', enabled: true }
		]
	});
	const plan = planServerMods(
		[
			mod('needs-quality', { dependencies: '["quality"]' }),
			mod('incompatible', { dependencies: '["!quality"]' }),
			mod('space-age', { enabled: false })
		],
		current,
		'2.0'
	);
	assert.ok(plan.problems.includes('incompatible conflicts with enabled quality'));
	assert.ok(
		plan.changes.some((change) => change.kind === 'disable' && change.name === 'space-age')
	);
	const disabled = planServerMods(
		[mod('needs-quality', { dependencies: '["quality"]' }), mod('quality', { enabled: false })],
		current,
		'2.0'
	);
	assert.ok(disabled.problems.includes('needs-quality requires quality, which this list disables'));
});

test('disables extra installed archives even before Factorio adds them to mod-list.json', () => {
	const plan = planServerMods([], state({ installed: { 'unlisted-archive': ['1.0.0'] } }), '2.0');
	assert.deepEqual(plan.changes, [{ kind: 'disable', name: 'unlisted-archive' }]);
});

test('protects unpacked development mods when a list requests another version', () => {
	const plan = planServerMods(
		[mod('development')],
		state({ installed: { development: ['1.0.0'] }, unpacked: { development: ['1.0.0'] } }),
		'2.0'
	);
	assert.ok(plan.problems.some((problem) => problem.includes('unpacked development mod')));
});

test('resolves transitive bundled dependencies from the selected installation', () => {
	const current = state({
		mods: [
			{ name: 'base', enabled: true },
			{ name: 'space-age', enabled: false },
			{ name: 'quality', enabled: false }
		],
		bundled: {
			'space-age': { version: '2.0.72', dependencies: ['base >= 2.0', 'quality'] },
			quality: { version: '2.0.72', dependencies: ['base >= 2.0'] }
		}
	});
	const plan = planServerMods([mod('space-age')], current, '2.0');
	assert.deepEqual(plan.problems, []);
	assert.ok(plan.changes.some((change) => change.kind === 'enable' && change.name === 'quality'));
	const conflict = planServerMods(
		[mod('space-age'), mod('incompatible', { dependencies: '["! quality"]' })],
		current,
		'2.0'
	);
	assert.ok(conflict.problems.includes('incompatible conflicts with enabled quality'));
});
