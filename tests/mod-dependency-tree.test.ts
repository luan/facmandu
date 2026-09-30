import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dependencyTreeMatches, modDependencyGraph } from '../src/lib/mod-dependency-tree';

const mod = (name: string, dependencies: string[], enabled = true) => ({
	name,
	title: name,
	dependencies: JSON.stringify(dependencies),
	enabled
});

describe('mod dependency navigation', () => {
	test('names every enabled parent of a shared dependency and preserves nested requirements', () => {
		const graph = modDependencyGraph([
			mod('palette', ['base', 'flib >= 0.17.0']),
			mod('calculator', ['palette', 'flib']),
			mod('disabled', ['flib'], false),
			mod('flib', [])
		]);
		assert.deepEqual(
			graph.requiredBy.get('flib')?.map((item) => item.name),
			['palette', 'calculator']
		);
		assert.deepEqual(
			graph.roots.map((item) => item.name),
			['calculator', 'disabled']
		);
		assert.deepEqual(
			graph.dependents.get('flib')?.map((item) => item.name),
			['palette', 'calculator', 'disabled']
		);
		assert.deepEqual(graph.children.get('palette'), [
			{ name: 'flib', type: 'required', version: { operator: '>=', version: '0.17.0' } }
		]);
	});
	test('shows missing requirements without turning optional integrations into requirements', () => {
		const graph = modDependencyGraph([
			mod('main', ['missing', '? installed', '? absent', '! conflict']),
			mod('installed', [])
		]);
		assert.deepEqual(
			graph.children.get('main')?.map((item) => item.name),
			['missing']
		);
		assert.equal(graph.requiredBy.has('installed'), false);
		assert.equal(graph.byName.has('missing'), false);
	});
	test('keeps disconnected cycles reachable and filters with all parent paths intact', () => {
		const graph = modDependencyGraph([
			mod('a', ['b']),
			mod('b', ['a']),
			mod('other', ['leaf']),
			mod('leaf', [])
		]);
		assert.deepEqual(
			graph.roots.map((item) => item.name),
			['other', 'a']
		);
		assert.deepEqual([...dependencyTreeMatches(graph.children, new Set(['b']))].sort(), ['a', 'b']);
		assert.deepEqual([...dependencyTreeMatches(graph.children, new Set(['leaf']))].sort(), [
			'leaf',
			'other'
		]);
	});
});
