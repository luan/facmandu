import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	modlistRouteBody,
	modlistRouteFromAnswers,
	modlistToolGroups,
	serverRouteBody,
	serverRouteFromAnswers,
	serverToolGroups
} from '../src/lib/assistant-routing';

function response(
	groups: readonly string[],
	choice: string,
	selected: readonly string[],
	confidence = 0.99,
	ambiguous = 0.01
) {
	return {
		answers: [
			{ name: 'intent', type: 'choice', choice, confidence },
			{ name: 'ambiguous', type: 'predicate', probability: ambiguous },
			...groups.map((name) => ({
				name,
				type: 'predicate',
				probability: selected.includes(name) ? 0.99 : 0.01
			}))
		]
	};
}

test('asks named choices and predicates together with recent private context', () => {
	const recent = Array.from({ length: 6 }, (_, index) => ({
		prompt: `Request ${index}`,
		answer: `Answer ${index}`
	}));
	for (const [body, groups] of [
		[serverRouteBody('What about it?', recent), serverToolGroups],
		[modlistRouteBody('What about it?', recent), modlistToolGroups]
	] as const) {
		assert.equal(body.model, 'gpt-6-luna');
		const input = JSON.parse(body.input);
		assert.equal(input.request, 'What about it?');
		assert.deepEqual(
			input.recent.map((turn: { prompt: string }) => turn.prompt),
			['Request 2', 'Request 3', 'Request 4', 'Request 5']
		);
		assert.deepEqual(
			body.questions.map((question) => question.name),
			['intent', 'ambiguous', ...groups]
		);
		const intent = body.questions[0];
		assert.equal(intent?.type, 'choice');
		assert.ok(
			intent?.type === 'choice' && intent.choices.some((choice) => choice.value === 'question')
		);
		assert.ok(body.questions.slice(1).every((question) => question.type === 'predicate'));
	}
});

test('routes compound requests to multiple groups and keeps status shortcut narrow', () => {
	assert.deepEqual(
		serverRouteFromAnswers(response(serverToolGroups, 'status', ['production', 'power', 'server'])),
		{
			intent: 'question',
			clarify: false,
			groups: ['production', 'power', 'server']
		}
	);
	assert.deepEqual(serverRouteFromAnswers(response(serverToolGroups, 'status', ['server'])), {
		intent: 'status',
		clarify: false,
		groups: ['server']
	});
	assert.deepEqual(modlistRouteFromAnswers(response(modlistToolGroups, 'inspect', ['inspect'])), {
		intent: 'inspect',
		clarify: false,
		groups: ['inspect']
	});
	assert.equal(
		modlistRouteFromAnswers(response(modlistToolGroups, 'inspect', ['inspect', 'changes'])).intent,
		'question'
	);
});

test('incomplete, refused, duplicate and invalid results retain all tools and cannot shortcut', () => {
	for (const [groups, parse, shortcut] of [
		[serverToolGroups, serverRouteFromAnswers, 'status'],
		[modlistToolGroups, modlistRouteFromAnswers, 'inspect']
	] as const) {
		const valid = response(groups, shortcut, [groups[0]]);
		const invalid = [
			null,
			{ answers: valid.answers.slice(0, -1) },
			{ answers: valid.answers.filter((answer) => answer.name !== 'ambiguous') },
			response(groups, shortcut, [groups[0]], 0.6),
			response(groups, 'unknown', [groups[0]]),
			{ answers: [...valid.answers, valid.answers[0]] },
			{ answers: [...valid.answers.slice(0, -1), { name: groups.at(-1), type: 'refusal' }] },
			{
				answers: [
					...valid.answers.slice(0, -1),
					{ name: groups.at(-1), type: 'predicate', probability: 2 }
				]
			}
		];
		for (const value of invalid)
			assert.deepEqual(parse(value), {
				intent: 'question',
				clarify: false,
				groups: [...groups]
			});
	}
});

test('uses answer names regardless of order and preserves ambiguity', () => {
	const data = response(modlistToolGroups, 'change', ['changes'], 0.99, 0.9);
	data.answers.reverse();
	assert.deepEqual(modlistRouteFromAnswers(data), {
		intent: 'change',
		clarify: true,
		groups: ['changes']
	});
});

test('provisioning and recommendation preference requests retain their tool routes', () => {
	const provisioning = modlistRouteBody('Create a server and new save from this list');
	assert.match(
		provisioning.questions.find((question) => question.name === 'server')?.instructions ?? '',
		/server or save/u
	);
	assert.deepEqual(
		modlistRouteFromAnswers(response(modlistToolGroups, 'question', ['server'])).groups,
		['server']
	);
	const dismissal = modlistRouteBody('Dismiss Blueprint Shotgun from recommendations');
	const intent = dismissal.questions[0];
	assert.ok(intent?.type === 'choice');
	assert.match(
		intent.choices.find((choice) => choice.value === 'change')?.description ?? '',
		/dismiss or restore recommendations/u
	);
	assert.match(
		dismissal.questions.find((question) => question.name === 'discover')?.instructions ?? '',
		/dismissing or restoring suggested mods/u
	);
	assert.deepEqual(modlistRouteFromAnswers(response(modlistToolGroups, 'change', ['discover'])), {
		intent: 'change',
		clarify: false,
		groups: ['discover']
	});
});
