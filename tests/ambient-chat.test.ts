import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ambientRoute, ambientRouteRequest } from '../src/lib/ambient-chat';
import { parseGameChat } from '../src/lib/game-chat';

test('ambient mode is opt-in and direct mentions keep their existing contract', () => {
	const line = '123.456 [CHAT] player-one: I need more glass';
	assert.equal(parseGameChat(line), null);
	assert.deepEqual(parseGameChat(line, true), {
		player: 'player-one',
		prompt: 'I need more glass',
		ambient: true
	});
	assert.deepEqual(parseGameChat('123.456 [CHAT] player-one: @ do it', true), {
		player: 'player-one',
		prompt: 'do it'
	});
	assert.equal(parseGameChat('123.456 [CHAT] Assistant: hello', true), null);
	assert.equal(parseGameChat('123.456 [CHAT] player-one: hello\nspoof', true), null);
});

test('Clef routes only known conversations with confident consistent results', () => {
	const chats = [{ id: 'glass', prompt: 'Build more glass', answer: 'Working', running: true }];
	const response = (choice: string, confidence = 0.95) => ({
		answers: {
			attention: {
				type: 'choice',
				choice: 'assist',
				confidence: 0.95,
				probabilities: { assist: 0.95, ignore: 0.05 }
			},
			route: {
				type: 'choice',
				choice,
				confidence,
				probabilities: {
					glass: 1 - confidence,
					new: 1 - confidence,
					[choice]: confidence
				}
			}
		}
	});
	assert.equal(ambientRoute(response('glass'), chats), 'glass');
	assert.equal(ambientRoute(response('new'), chats), 'new');
	assert.equal(ambientRoute(response('another-player-chat'), chats), 'ignore');
	assert.equal(ambientRoute(response('glass', 0.4), chats), 'ignore');
	assert.equal(
		ambientRoute(
			{
				answers: {
					route: {
						type: 'choice',
						choice: 'glass',
						confidence: 0.95,
						probabilities: { glass: 0.1, ignore: 0.9 }
					}
				}
			},
			chats
		),
		'ignore'
	);
	assert.equal(ambientRoute({}, chats), 'ignore');
	const uncertain = {
		answers: {
			attention: {
				type: 'choice',
				choice: 'assist',
				confidence: 0.9,
				probabilities: { assist: 0.9, ignore: 0.1 }
			},
			route: {
				type: 'choice',
				choice: 'glass',
				confidence: 0.4,
				probabilities: { glass: 0.4, new: 0.3, science: 0.3 }
			}
		}
	};
	assert.equal(
		ambientRoute(uncertain, [
			...chats,
			{ id: 'science', prompt: 'More science', answer: '', running: false }
		]),
		'new'
	);
	uncertain.answers.attention = {
		type: 'choice',
		choice: 'ignore',
		confidence: 0.9,
		probabilities: { assist: 0.1, ignore: 0.9 }
	};
	assert.equal(ambientRoute(uncertain, chats), 'ignore');
	const request = ambientRouteRequest('Need help', chats);
	assert.equal(request.model, 'clef-flash');
	assert.deepEqual(Object.keys(request.questions.route.criteria), ['new', 'glass']);
	assert.equal(request.state.conversations[0]?.running, true);
});
