import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionRequest, needsContinuation } from '../src/lib/assistant-completion';

test('only a consistent confident unfinished result continues the response', () => {
	const result = (choice: string, confidence: number, unfinished: number, finished: number) => ({
		answers: {
			completion: {
				type: 'choice',
				choice,
				confidence,
				probabilities: { continue: unfinished, finish: finished }
			}
		}
	});
	assert.equal(needsContinuation(result('continue', 0.95, 0.95, 0.05)), true);
	assert.equal(needsContinuation(result('finish', 0.95, 0.05, 0.95)), false);
	assert.equal(needsContinuation(result('continue', 0.6, 0.6, 0.4)), false);
	assert.equal(needsContinuation(result('continue', 0.95, 0.1, 0.9)), false);
	assert.equal(needsContinuation(result('continue', 0.95, 0.95, 0.9)), false);
	assert.equal(needsContinuation(result('place', 0.95, 0.95, 0.05)), false);
	assert.equal(needsContinuation({}), false);
	const request = completionRequest(['I need more glass.', 'Use a new mine.'], 'Still checking.', [
		{ tool: 'factory_query', isError: false }
	]);
	assert.deepEqual(request.state.requests, ['I need more glass.', 'Use a new mine.']);
	assert.equal(request.model, 'clef-flash');
});
