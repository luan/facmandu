import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextDeficitState, nextResearchState } from '../src/lib/server/factory-watch-state';

const empty = {
	lastSampledAt: null,
	lastChangedAt: null,
	lastResearch: null,
	lastProgress: null,
	alerting: false
};

test('research alerts once after five minutes without progress, then rearms on progress', () => {
	const start = new Date(0);
	let sample = nextResearchState(empty, 'automation:1', 42, start);
	for (let minute = 1; minute < 5; minute++) {
		sample = nextResearchState(sample, 'automation:1', 42, new Date(minute * 60_000));
		assert.equal(sample.notify, false);
	}
	const stalled = nextResearchState(sample, 'automation:1', 42, new Date(300_000));
	assert.equal(stalled.notify, true);
	assert.equal(nextResearchState(stalled, 'automation:1', 42, new Date(360_000)).notify, false);
	const moving = nextResearchState(stalled, 'automation:1', 43, new Date(360_000));
	assert.equal(moving.alerting, false);
	let later = moving;
	for (let minute = 7; minute <= 11; minute++)
		later = nextResearchState(later, 'automation:1', 43, new Date(minute * 60_000));
	assert.equal(later.notify, true);
});

test('missing research and sampling gaps cannot establish a stall', () => {
	const first = nextResearchState(empty, 'automation:1', 42, new Date(0));
	assert.equal(nextResearchState(first, null, null, new Date(300_000)).notify, false);
	assert.equal(nextResearchState(first, 'automation:1', 42, new Date(300_000)).notify, false);
});

test('item deficit alerts only on crossing into consumption above production', () => {
	assert.deepEqual(nextDeficitState(10, 11, false), { alerting: true, notify: true });
	assert.deepEqual(nextDeficitState(10, 11, true), { alerting: true, notify: false });
	assert.deepEqual(nextDeficitState(11, 10, true), { alerting: false, notify: false });
	assert.deepEqual(nextDeficitState(10, 11, false), { alerting: true, notify: true });
});
