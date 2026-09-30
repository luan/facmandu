import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	composeRanking,
	rankingAnswerSchema,
	rankingQuestions,
	rankingState
} from '../src/lib/recommendation-ranking';
import { recommendationPriority } from '../src/lib/recommendations';

test('ranks every candidate in one batch with explicit candidate identities', () => {
	const questions = rankingQuestions([{ name: 'planet' }, { name: 'patch' }]);
	assert.equal(Object.keys(questions).length, 6);
	assert.deepEqual(
		Object.values(questions).map((question) => question.instructions.candidate),
		['planet', 'planet', 'planet', 'patch', 'patch', 'patch']
	);
});

test('combines distinct ratings on a ten point scale without inflating certainty', () => {
	const result = composeRanking(
		{
			candidate_0_fit: { type: 'score', score: 3, confidence: 0.9 },
			candidate_0_novelty: { type: 'score', score: 1.5, confidence: 0.6 },
			candidate_0_integration: { type: 'score', score: 0, confidence: 0.8 }
		},
		0
	);
	assert.equal(result?.score, 6.25);
	assert.equal(result?.confidence, 0.6);
	assert.deepEqual(
		result?.dimensions.map((dimension) => dimension.score),
		[10, 5, 0]
	);
});

test('incomplete or out-of-range answers cannot become a ranking', () => {
	assert.equal(
		composeRanking({ candidate_0_fit: { type: 'score', score: 3, confidence: 1 } }, 0),
		null
	);
	for (const score of [-1, 4, Number.NaN]) {
		assert.equal(
			rankingAnswerSchema.safeParse({
				answers: { candidate_0_fit: { type: 'score', score, confidence: 1 } }
			}).success,
			false
		);
	}
});

test('bounds a full page against a large mod list without losing identities or dependencies', () => {
	const enabledMods = Array.from({ length: 300 }, (_, index) => ({
		name: `enabled-${index}`,
		summary: 'Production and logistics. '.repeat(40),
		description: '工場🏭'.repeat(1000)
	}));
	const candidates = Array.from({ length: 12 }, (_, index) => ({
		name: `candidate-${index}`,
		summary: 'New production chains',
		description: 'Extra recipes and buildings. '.repeat(1000),
		dependencies: ['base >= 2.0', '? enabled-0'],
		recommendedBy: ['enabled-0']
	}));
	const state = rankingState('2.0', enabledMods, candidates);
	assert.ok(new TextEncoder().encode(JSON.stringify(state)).length <= 60_000);
	assert.deepEqual(
		state.enabledMods.map((mod) => mod.name),
		enabledMods.map((mod) => mod.name)
	);
	assert.equal(state.candidates.length, 12);
	for (const [index, candidate] of state.candidates.entries()) {
		assert.deepEqual(candidate.dependencies, candidates[index]?.dependencies);
		assert.deepEqual(candidate.recommendedBy, ['enabled-0']);
		assert.ok(candidate.description.length > 0);
	}
	assert.equal(Object.keys(rankingQuestions(state.candidates)).length, 36);
	assert.equal(enabledMods[0]?.description, '工場🏭'.repeat(1000));
	const fallback = rankingState('2.0', enabledMods, candidates, 28_000);
	assert.ok(new TextEncoder().encode(JSON.stringify(fallback)).length <= 28_000);
	assert.equal(fallback.enabledMods.length, enabledMods.length);
});

test('keeps complete evidence when it fits and refuses to discard mod identities', () => {
	const mods = [{ name: 'planet', summary: 'A new planet', description: 'A sulfur ocean' }];
	assert.deepEqual(rankingState('2.0', mods, mods), {
		factorioVersion: '2.0',
		enabledMods: mods,
		candidates: mods,
		dismissedMods: []
	});
	assert.throws(() => rankingState('2.0', [{ name: 'x'.repeat(60_000) }], []), /too large/);
});

test('confident good matches outrank uncertain high scores without rewarding confident bad matches', () => {
	assert.ok(
		recommendationPriority({ score: 6, confidence: 0.9 }) >
			recommendationPriority({ score: 10, confidence: 0.6 })
	);
	assert.ok(
		recommendationPriority({ score: 7, confidence: 0.9 }) >
			recommendationPriority({ score: 9, confidence: 0.4 })
	);
	assert.ok(
		recommendationPriority({ score: 7, confidence: 0.9 }) >
			recommendationPriority({ score: 2, confidence: 1 })
	);
	assert.ok(
		recommendationPriority({ score: 0, confidence: 0 }) > recommendationPriority(undefined)
	);
	for (const score of [0, 3, 7, 10]) {
		assert.equal(recommendationPriority({ score, confidence: 1 }), score);
		assert.equal(recommendationPriority({ score, confidence: 0 }), 0);
	}
});

test('dismissed evidence shares the size budget and restoring removes it', () => {
	const dismissed = [
		{
			name: 'newsletter',
			summary: 'Notifications about new mods',
			description: 'Details. '.repeat(10_000)
		}
	];
	const state = rankingState('2.0', [], [{ name: 'candidate' }], 2000, dismissed);
	assert.ok(new TextEncoder().encode(JSON.stringify(state)).length <= 2000);
	assert.equal(state.dismissedMods[0]?.name, 'newsletter');
	assert.ok(state.dismissedMods[0]?.summary);
	assert.deepEqual(rankingState('2.0', [], [{ name: 'candidate' }]).dismissedMods, []);
});
