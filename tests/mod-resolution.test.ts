import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type ReleaseCatalog,
	type ResolutionMod,
	type ResolutionRelease,
	resolveModList
} from '../src/lib/mod-resolution';

const mod = (name: string, overrides: Partial<ResolutionMod> = {}): ResolutionMod => ({
	name,
	enabled: true,
	icebox: false,
	version: '1.0.0',
	...overrides
});
const release = (
	version: string,
	dependencies: string[] = [],
	factorioVersion = '2.0'
): ResolutionRelease => ({ version, dependencies, factorioVersion });
const catalog = (entries: Record<string, ResolutionRelease[]>) =>
	new Map(
		Object.entries(entries).map(([name, releases]): [string, ReleaseCatalog] => [
			name,
			{ releases, complete: true }
		])
	);

test('resolves required transitive dependencies, preserves compatible versions, and excludes optional mods', () => {
	const result = resolveModList(
		[mod('root')],
		catalog({
			root: [release('1.0.0', ['library >= 2.0.0', '? optional']), release('2.0.0')],
			library: [release('1.0.0'), release('2.1.0', ['helper'])],
			helper: [release('1.0.0')]
		}),
		'2.0'
	);
	assert.deepEqual(result.issues, []);
	assert.deepEqual(result.additions.sort(), ['helper', 'library']);
	assert.equal(result.selected.get('root')?.version, '1.0.0');
	assert.equal(result.selected.get('library')?.version, '2.1.0');
	assert.equal(result.selected.has('optional'), false);
});

test('selects an older compatible dependency instead of taking the latest release', () => {
	const result = resolveModList(
		[mod('root'), mod('library', { version: '3.0.0' })],
		catalog({
			root: [release('1.0.0', ['library < 2.0.0'])],
			library: [release('1.2.0'), release('3.0.0'), release('1.3.0', [], '2.1')]
		}),
		'2.0'
	);
	assert.equal(result.selected.get('library')?.version, '1.2.0');
	assert.deepEqual(result.issues, []);
});

test('cycles converge without duplicate additions', () => {
	const result = resolveModList(
		[mod('root')],
		catalog({ root: [release('1.0.0', ['library'])], library: [release('1.0.0', ['root'])] }),
		'2.0'
	);
	assert.equal(result.stable, true);
	assert.deepEqual(result.additions, ['library']);
});

test('requests complete metadata only when the cached release cannot satisfy a requirement', () => {
	const catalogs = catalog({ root: [release('1.0.0', ['library >= 2.0.0'])] });
	catalogs.set('library', { complete: false, releases: [release('1.0.0')] });
	const result = resolveModList([mod('root')], catalogs, '2.0');
	assert.deepEqual(result.missingMetadata, ['library']);
	assert.deepEqual(result.additions, []);
});

test('incompatible constraints and transitive conflicts remain visible without unsafe additions', () => {
	const contradictory = resolveModList(
		[mod('a'), mod('b')],
		catalog({
			a: [release('1.0.0', ['library >= 2.0.0'])],
			b: [release('1.0.0', ['library < 2.0.0'])],
			library: [release('1.0.0'), release('2.0.0')]
		}),
		'2.0'
	);
	assert.deepEqual(contradictory.additions, []);
	assert.match(contradictory.issues[0]?.message ?? '', /No release supports/);
	const conflict = resolveModList(
		[mod('root')],
		catalog({
			root: [release('1.0.0', ['library'])],
			library: [release('1.0.0', ['helper'])],
			helper: [release('1.0.0', ['! root'])]
		}),
		'2.0'
	);
	assert.deepEqual(conflict.additions, []);
	assert.ok(conflict.issues.some((issue) => issue.message === 'Conflicts with root'));
});

test('required disabled and icebox mods are enabled while unrelated ones stay out', () => {
	const result = resolveModList(
		[
			mod('root'),
			mod('library', { enabled: false, icebox: true }),
			mod('unrelated', { enabled: false })
		],
		catalog({
			root: [release('1.0.0', ['library'])],
			library: [release('1.0.0')],
			unrelated: [release('1.0.0')]
		}),
		'2.0'
	);
	assert.deepEqual(result.additions, ['library']);
	assert.equal(result.selected.has('unrelated'), false);
});

test('optional version constraints apply only when that mod is present', () => {
	const catalogs = catalog({
		root: [release('1.0.0', ['? library < 2.0.0'])],
		library: [release('1.0.0'), release('2.0.0')]
	});
	assert.deepEqual(resolveModList([mod('root')], catalogs, '2.0').additions, []);
	const result = resolveModList(
		[mod('root'), mod('library', { version: '2.0.0' })],
		catalogs,
		'2.0'
	);
	assert.equal(result.selected.get('library')?.version, '1.0.0');
});

test('explicit updates select newer compatible releases and resolve their dependencies', () => {
	const mods = [mod('root'), mod('library')];
	const catalogs = catalog({
		root: [release('1.0.0'), release('2.0.0', ['library >= 2.0.0']), release('3.0.0', [], '2.1')],
		library: [release('1.0.0'), release('2.1.0')]
	});
	const unchanged = resolveModList(mods, catalogs, '2.0');
	assert.equal(unchanged.selected.get('root')?.version, '1.0.0');
	const updated = resolveModList(mods, catalogs, '2.0', new Set(['root']));
	assert.equal(updated.selected.get('root')?.version, '2.0.0');
	assert.equal(updated.selected.get('library')?.version, '2.1.0');
	assert.deepEqual(updated.issues, []);
});
