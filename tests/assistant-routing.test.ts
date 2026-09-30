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

test('asks intent, clarification and each relevant group in one contextual request', () => {
	const recent = Array.from({ length: 6 }, (_, index) => ({
		prompt: `Request ${index}`,
		answer: `Answer ${index}`
	}));
	for (const body of [
		serverRouteBody('What about it?', recent),
		modlistRouteBody('What about it?', recent)
	]) {
		assert.equal(body.state.request, 'What about it?');
		assert.deepEqual(
			body.state.recent.map((turn) => turn.prompt),
			['Request 2', 'Request 3', 'Request 4', 'Request 5']
		);
		assert.ok(body.questions.intent);
		assert.ok(body.questions.ambiguous);
	}
	assert.deepEqual(Object.keys(serverRouteBody('x').questions).slice(2), serverToolGroups);
	assert.deepEqual(Object.keys(modlistRouteBody('x').questions).slice(2), modlistToolGroups);
});

test('routes compound requests to multiple groups and keeps status shortcut narrow', () => {
	const answers = {
		intent: { choice: 'status', confidence: 0.99 },
		ambiguous: { noul: 0.01 },
		research: { noul: 0.01 },
		production: { noul: 0.92 },
		power: { noul: 0.86 },
		logistics: { noul: 0.01 },
		server: { noul: 0.8 },
		watches: { noul: 0.01 },
		planning: { noul: 0.01 }
	};
	assert.deepEqual(serverRouteFromAnswers({ answers }), {
		intent: 'question',
		clarify: false,
		groups: ['production', 'power', 'server']
	});
	assert.equal(
		serverRouteFromAnswers({
			answers: { ...answers, production: { noul: 0.01 }, power: { noul: 0.01 } }
		}).intent,
		'status'
	);
});

test('uses all groups on incomplete, low-confidence and unavailable results', () => {
	assert.deepEqual(serverRouteFromAnswers(null).groups, [...serverToolGroups]);
	assert.deepEqual(
		serverRouteFromAnswers({ answers: { intent: { choice: 'question', confidence: 0.99 } } })
			.groups,
		[...serverToolGroups]
	);
	assert.deepEqual(
		modlistRouteFromAnswers({ answers: { intent: { choice: 'change', confidence: 0.6 } } }),
		{ intent: 'question', clarify: false, groups: [...modlistToolGroups] }
	);
	assert.deepEqual(
		modlistRouteFromAnswers({
			answers: {
				intent: { choice: 'change', confidence: 0.95 },
				ambiguous: { noul: 0.9 },
				inspect: { noul: 0.9 },
				discover: { noul: 0.9 },
				changes: { noul: 0.9 }
			}
		}),
		{ intent: 'change', clarify: true, groups: [...modlistToolGroups] }
	);
});

test('legacy fixture answers still allow simple list and server status', () => {
	assert.equal(
		modlistRouteFromAnswers({
			answers: { intent: { choice: 'inspect', confidence: 0.99 }, ambiguous: { noul: 0.01 } }
		}).intent,
		'inspect'
	);
	assert.equal(
		serverRouteFromAnswers({ answers: { intent: { choice: 'status', confidence: 0.99 } } }).intent,
		'status'
	);
});

test('provisioning requests select server tools from the list assistant', () => {
	const body = modlistRouteBody('Create a server and new save from this list');
	assert.match(body.questions.server.instructions, /server or save/u);
	assert.deepEqual(
		modlistRouteFromAnswers({
			answers: {
				intent: { choice: 'question', confidence: 0.99 },
				ambiguous: { noul: 0.01 },
				inspect: { noul: 0.01 },
				discover: { noul: 0.01 },
				changes: { noul: 0.01 },
				server: { noul: 0.99 }
			}
		}).groups,
		['server']
	);
});

test('dismissal is an explicit preference action with a discover tool route', () => {
	const body = modlistRouteBody('Dismiss Blueprint Shotgun from recommendations');
	assert.match(body.questions.intent.criteria.change, /dismiss or restore recommendations/u);
	assert.match(body.questions.discover.instructions, /dismissing or restoring suggested mods/u);
	assert.deepEqual(
		modlistRouteFromAnswers({
			answers: {
				intent: { choice: 'change', confidence: 0.98 },
				ambiguous: { noul: 0.01 },
				inspect: { noul: 0.01 },
				discover: { noul: 0.98 },
				changes: { noul: 0.01 },
				server: { noul: 0.01 }
			}
		}),
		{ intent: 'change', clarify: false, groups: ['discover'] }
	);
});
