import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendationCandidates, recommendationRelease } from '../src/lib/recommendations';

test('recommendations include optional companions only and exclude known conflicts and existing mods', () => {
	const candidates = recommendationCandidates([
		{
			name: 'overhaul',
			enabled: true,
			dependencies:
				'["? companion >= 1.0", "library", "? installed", "? conflict", "! conflict", "? base"]'
		},
		{ name: 'second', enabled: true, dependencies: '["+ companion < 2"]' },
		{ name: 'installed', enabled: false, dependencies: null },
		{ name: 'disabled', enabled: false, dependencies: '["? unrelated"]' }
	]);
	assert.deepEqual(
		candidates.map((candidate) => candidate.name),
		['companion']
	);
	const candidate = candidates[0];
	assert.ok(candidate);
	assert.deepEqual(candidate.recommendedBy, ['overhaul', 'second']);
	const release = recommendationRelease(
		[
			{ version: '1.2.0', info_json: { factorio_version: '2.0', dependencies: ['base'] } },
			{ version: '1.10.0', info_json: { factorio_version: '2.0', dependencies: ['base'] } },
			{ version: '1.11.0', info_json: { factorio_version: '2.1', dependencies: ['base'] } },
			{ version: '1.12.0', info_json: { factorio_version: '2.0', dependencies: ['! overhaul'] } },
			{ version: '2.0.0', info_json: { factorio_version: '2.0', dependencies: ['base'] } }
		],
		candidate,
		[{ name: 'overhaul', enabled: true, dependencies: null }],
		'2.0'
	);
	assert.equal(release?.version, '1.10.0');
});
