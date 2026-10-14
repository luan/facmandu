import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	completionDecision,
	completionRequest,
	missingCommandContent,
	missingFactoryCheck,
	missingFactoryDesignAttempt,
	unfinishedFactoryConnections
} from '../src/lib/assistant-completion';

test('a requested command cannot settle as a reference to a hidden earlier draft', () => {
	const requests = ['Delete concrete ghosts.', 'What Lua command could I run?'];
	assert.equal(missingCommandContent(requests, 'The console command above is ready to run.'), true);
	assert.equal(missingCommandContent(requests, 'Run the previous command.'), true);
	assert.equal(missingCommandContent(requests, 'Run this:\n```\n/players\n```'), false);
	assert.equal(missingCommandContent(requests, 'The command above is `/players`.'), false);
	assert.equal(missingCommandContent(requests, 'I could not verify a safe command.'), false);
	assert.equal(
		missingCommandContent(['Design a blueprint.'], 'The blueprint above is ready.'),
		false
	);
});

test('a resolved expansion must attempt a layout or factory action before declining it', () => {
	const planned = [{ tool: 'plan_production', isError: false }];
	assert.equal(missingFactoryDesignAttempt(['I need more glass.'], planned), true);
	for (const tool of ['blueprint_operation', 'factory_action']) {
		assert.equal(
			missingFactoryDesignAttempt(['I need more glass.'], [...planned, { tool, isError: true }]),
			false
		);
	}
	assert.equal(
		missingFactoryDesignAttempt(
			['I need more glass.'],
			[{ tool: 'plan_production', isError: true }]
		),
		false
	);
	assert.equal(missingFactoryDesignAttempt(['I need a blueprint only.'], planned), false);
	assert.equal(missingFactoryDesignAttempt(['How could I make more glass?'], planned), false);
	for (const steering of ['Do not place anything.', 'Stop.', 'Just inspect the factory.']) {
		assert.equal(missingFactoryDesignAttempt(['I need more glass.', steering], planned), false);
		assert.equal(
			unfinishedFactoryConnections(['I need more glass.', steering], 'Nothing placed.'),
			false
		);
	}
});

test('current factory checks require fresh inspection while advice and verified read failures can finish', () => {
	const status = [{ tool: 'server_status', isError: false }];
	for (const request of [
		'Does the new glass line connect to the bus?',
		'Are our machines working?',
		'Check the factory.'
	]) {
		assert.equal(missingFactoryCheck([request], status), true);
		assert.equal(
			missingFactoryCheck([request], [...status, { tool: 'factory_batch', isError: false }]),
			false
		);
		assert.equal(
			missingFactoryCheck([request], [...status, { tool: 'factory_lookup', isError: true }]),
			false
		);
	}
	for (const request of [
		'How do I connect belts?',
		'Can you design a blueprint?',
		'Is the server running?',
		'Thanks.'
	]) {
		assert.equal(missingFactoryCheck([request], status), false);
	}
});

test('an expansion with admitted connection gaps continues, while stock shortages and design requests do not', () => {
	const answer = 'Ghosts placed. The inspection could not verify power or a sand-feed connection.';
	assert.equal(unfinishedFactoryConnections(['I need more glass.'], answer), true);
	assert.equal(
		unfinishedFactoryConnections(
			['I need more glass.'],
			'The design is not placed because belts are missing from stock.'
		),
		true
	);
	assert.equal(
		unfinishedFactoryConnections(['I need glass.'], 'The supply connection remains unverified.'),
		true
	);
	assert.equal(
		unfinishedFactoryConnections(
			['I need more glass.'],
			'The connected ghost layout is complete; six belts await stock.'
		),
		false
	);
	assert.equal(
		unfinishedFactoryConnections(['I need more glass.'], 'Delivery remains unverified.'),
		false
	);
	assert.equal(unfinishedFactoryConnections(['I need a blueprint only.'], answer), false);
	assert.equal(unfinishedFactoryConnections(['How could I make more glass?'], answer), false);
});

test('construction requests cannot finish with unresolved ingredient feeds', () => {
	const answer =
		'All 18 ghosts are placed. The sand feed from nearby chests remains unresolved, so the furnaces cannot be counted on to run yet.';
	for (const request of [
		'we need more glass on the bus',
		'Build more glass production.',
		'Can you please construct a robot factory?',
		'Design and place a glass production blueprint.'
	]) {
		assert.equal(unfinishedFactoryConnections([request], answer), true);
	}
	for (const request of [
		'I need a blueprint only.',
		'Can you design a blueprint?',
		'Where should we place more glass production?',
		'Can you explain how to build this?'
	]) {
		assert.equal(unfinishedFactoryConnections([request], answer), false);
	}
	assert.equal(
		unfinishedFactoryConnections(
			['Build more glass production.', 'Do not place anything.'],
			answer
		),
		false
	);
});

test('completion decisions require consistent confident evidence', () => {
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
	assert.equal(completionDecision(result('continue', 0.95, 0.95, 0.05)), 'continue');
	assert.equal(completionDecision(result('continue', 0.75, 0.75, 0.25)), 'continue');
	assert.equal(completionDecision(result('finish', 0.95, 0.05, 0.95)), 'finish');
	assert.equal(completionDecision(result('finish', 0.95, 0.95, 0.05)), null);
	assert.equal(completionDecision(result('finish', 0.6, 0.4, 0.6)), null);
	assert.equal(completionDecision({}), null);
	assert.equal(completionDecision(result('continue', 0.6, 0.6, 0.4)), null);
	assert.equal(completionDecision(result('continue', 0.95, 0.1, 0.9)), null);
	assert.equal(completionDecision(result('continue', 0.95, 0.95, 0.9)), null);
	assert.equal(completionDecision(result('place', 0.95, 0.95, 0.05)), null);
	const request = completionRequest(['I need more glass.', 'Use a new mine.'], 'Still checking.', [
		{ tool: 'factory_query', isError: false }
	]);
	assert.deepEqual(request.state.requests, ['I need more glass.', 'Use a new mine.']);
	assert.equal(request.model, 'clef-flash');
});
