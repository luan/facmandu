import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectDependencies, parseDependencies, satisfiesVersion } from '../src/lib/dependencies';
import { validateDependencies } from '../src/lib/server/services/dependencies';

test('Factorio recommended mods do not block a list', () => {
	const dependencies = JSON.stringify([
		'base',
		'recycler',
		'+ FluidWagonColorMask',
		'? optional',
		'(?) hidden',
		'~ required',
		'! conflict'
	]);
	assert.deepEqual(parseDependencies(dependencies), [
		{ name: 'base', type: 'required' },
		{ name: 'recycler', type: 'required' },
		{ name: 'FluidWagonColorMask', type: 'optional' },
		{ name: 'optional', type: 'optional' },
		{ name: 'hidden', type: 'optional' },
		{ name: 'required', type: 'required' },
		{ name: 'conflict', type: 'conflict' }
	]);
	assert.deepEqual(
		validateDependencies([{ name: 'example', enabled: true, dependencies, version: '1.0.0' }])
			.missingDependencies,
		['required']
	);
});

test('malformed metadata is reported and valid neighboring dependencies remain usable', () => {
	for (const value of ['not json', '{}', '[42]', '["library >= nope"]'])
		assert.ok(inspectDependencies(value).errors.length > 0);
	const result = inspectDependencies('["library >= 1.10.0", 42]');
	assert.equal(result.dependencies[0]?.version?.version, '1.10.0');
	assert.equal(result.errors.length, 1);
});

test('version comparisons use numeric components and enforce every operator', () => {
	assert.equal(satisfiesVersion('1.10.0', { operator: '>', version: '1.9.0' }), true);
	assert.equal(satisfiesVersion('1.10.0', { operator: '<', version: '1.9.0' }), false);
	assert.equal(satisfiesVersion('1.0.0', { operator: '=', version: '1.0.0' }), true);
	assert.equal(satisfiesVersion('1.0.0', { operator: '<=', version: '1.0.0' }), true);
	assert.equal(satisfiesVersion('1.0.0', { operator: '>=', version: '1.0.0' }), true);
	assert.equal(satisfiesVersion('1.0', { operator: '=', version: '1.0.0' }), false);
	assert.equal(satisfiesVersion('65536.0.0', { operator: '>', version: '1.0.0' }), false);
});

test('accepts portal dependency names with spaces and abbreviated version constraints', () => {
	const parsed = inspectDependencies(
		'["base >= 2.0", "Flare Stack >= 4.0.0", "? Orbital Ion Cannon", "!Side Inserters"]'
	);
	assert.deepEqual(parsed.errors, []);
	assert.deepEqual(
		parsed.dependencies.map((dependency) => dependency.name),
		['base', 'Flare Stack', 'Orbital Ion Cannon', 'Side Inserters']
	);
	assert.deepEqual(parsed.dependencies[0]?.version, { operator: '>=', version: '2.0.0' });
});

test('bundled versions are supplied by the server, not stale portal placeholder records', () => {
	const result = validateDependencies([
		{ name: 'example', enabled: true, version: '1.0.0', dependencies: '["base >= 2.0"]' },
		{ name: 'base', enabled: true, version: null, dependencies: null }
	]);
	assert.deepEqual(result.versionIssues, []);
});

test('list review reports incompatible releases and missing metadata only for enabled portal mods', () => {
	const mods = [
		{ name: 'old', enabled: true, version: '1.0.0', factorioVersion: '2.0', dependencies: '[]' },
		{ name: 'unknown', enabled: true, version: null, dependencies: null },
		{ name: 'disabled', enabled: false, version: null, dependencies: null },
		{ name: 'base', enabled: true, version: null, dependencies: null }
	];
	const result = validateDependencies(mods, '2.1');
	assert.deepEqual(result.compatibilityIssues, [{ mod: 'old', actual: '2.0', target: '2.1' }]);
	assert.deepEqual(result.metadataErrors, [
		{ mod: 'unknown', message: 'Dependency metadata is missing' }
	]);
});
