import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentRunError } from '@flue/runtime';
import { assistantErrorMessage } from '../src/lib/server/assistant-error';

test('provider account suspension gives recovery steps without exposing its response', () => {
	const message = assistantErrorMessage(
		new AgentRunError({
			outcome: 'failed',
			submissionId: 'test-submission',
			cause: {
				name: 'FlueError',
				message:
					'dispatch failed: 412 {"message":"Account private-account is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices.","token":"private-token"}'
			}
		})
	);
	assert.match(message, /Check billing or the monthly spending limit/u);
	assert.match(message, /choose another provider/u);
	assert.doesNotMatch(message, /private-account/u);
	assert.doesNotMatch(message, /private-token/u);
});

test('unknown failures never expose raw exception messages', () => {
	const cyclic = { message: 'private-token', cause: {} };
	cyclic.cause = cyclic;
	for (const cause of [new Error('private-token'), 'private-token', null, cyclic])
		assert.equal(assistantErrorMessage(cause), 'Could not finish this response. Try again.');
});

test('provider token limits explain recovery without exposing its private response', () => {
	const error = new Error('429 tpm_uncached_exceeded private-account private-token');
	const message = assistantErrorMessage(error);
	assert.match(message, /uncached conversation context/u);
	assert.match(message, /start a new chat/u);
	assert.doesNotMatch(message, /private-account|private-token/u);
	assert.match(assistantErrorMessage(new Error('429 rate_limit_error')), /wait briefly/u);
});

test('exhausted socket recovery explains the saved work without exposing provider data', () => {
	const message = assistantErrorMessage(
		new Error('The socket connection was closed unexpectedly. private-token')
	);
	assert.match(message, /model connection kept dropping/u);
	assert.match(message, /work is saved/u);
	assert.doesNotMatch(message, /private-token/u);
});
