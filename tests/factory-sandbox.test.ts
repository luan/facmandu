import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sandboxResultSchema } from '../src/lib/server/factory-sandbox';

for (const measured of [46, 48, 56]) {
	test(`a batch allowance cannot qualify ${measured}/60 measured output`, () => {
		const result = sandboxResultSchema.parse({
			id: '1',
			status: 'done',
			passed: true,
			verdict: 'passed',
			outputs: [
				{ name: 'kr-glass', perMinute: measured, targetPerMinute: 60, met: true, batchTolerance: 8 }
			]
		});
		assert.equal(result.passed, false);
		assert.equal(result.verdict, 'inconclusive');
		assert.equal(result.outputs?.[0]?.met, false);
		assert.equal(result.outputs?.[0]?.perMinute, measured);
	});
}

test('every requested output must meet its measured target', () => {
	const result = sandboxResultSchema.parse({
		id: '2',
		status: 'done',
		passed: true,
		verdict: 'passed',
		outputs: [
			{ name: 'logistic-robot', perMinute: 10, targetPerMinute: 10, met: true },
			{ name: 'construction-robot', perMinute: 3, targetPerMinute: 10, met: true }
		]
	});
	assert.equal(result.passed, false);
	assert.deepEqual(
		result.outputs?.map((o) => o.met),
		[true, false]
	);
});

test('measured success and actual failures retain their evidence', () => {
	for (const [passed, measured, verdict] of [
		[true, 60, 'passed'],
		[false, 0, 'below_target']
	] as const) {
		const native = {
			id: '3',
			status: 'done',
			passed,
			verdict,
			outputs: [{ perMinute: measured, targetPerMinute: 60, met: passed }],
			faults: passed ? [] : [{ name: 'inserter', status: 'no_power' }]
		};
		assert.deepEqual(sandboxResultSchema.parse(native), native);
	}
});
