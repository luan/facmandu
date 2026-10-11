import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantErrorMessage } from '../src/lib/server/assistant-error';

test('provider account suspension gives recovery steps without exposing its response', () => {
	const message = assistantErrorMessage(
		new Error(
			'dispatch failed: 412 {"message":"Account private-account is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices.","token":"private-token"}'
		)
	);
	assert.match(message, /Check billing or the monthly spending limit/u);
	assert.match(message, /choose another provider/u);
	assert.doesNotMatch(message, /private-account/u);
	assert.doesNotMatch(message, /private-token/u);
});

test('unknown failures never expose raw exception messages', () => {
	for (const cause of [new Error('private-token'), 'private-token', null])
		assert.equal(assistantErrorMessage(cause), 'Could not finish this response. Try again.');
});
