import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateLogisticsOutputs, sandboxResultSchema } from '../src/lib/server/factory-sandbox';

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

test('shared provider output is qualified by total product rate, without relaxing other products', () => {
	const measured = {
		id: 'array',
		status: 'done',
		passed: false,
		outputs: Array.from({ length: 32 }, (_, i) => ({
			name: 'rocket-fuel',
			kind: 'item',
			perMinute: i < 10 ? 3.5 : 4,
			targetPerMinute: 3.75,
			met: i >= 10,
			sampleSufficient: true
		}))
	};
	assert.equal(sandboxResultSchema.parse(measured).passed, false);
	const total = aggregateLogisticsOutputs(measured);
	assert.equal(total.passed, true);
	assert.equal(total.outputs?.length, 1);
	assert.equal(total.outputs?.[0]?.perMinute, 123);
	assert.equal(total.outputs?.[0]?.targetPerMinute, 120);
	assert.equal(total.outputs?.[0]?.endpointCount, 32);
	for (const outputs of [
		measured.outputs.map((o) => ({ ...o, perMinute: 3.5 })),
		[
			...measured.outputs,
			{
				name: 'other',
				kind: 'item',
				perMinute: 0,
				targetPerMinute: 10,
				met: false,
				sampleSufficient: true
			}
		],
		measured.outputs.map((o) => ({ ...o, sampleSufficient: false }))
	])
		assert.equal(aggregateLogisticsOutputs({ ...measured, outputs }).passed, false);
	assert.equal(aggregateLogisticsOutputs({ ...measured, status: 'error' }).passed, false);
	assert.equal(aggregateLogisticsOutputs({ ...measured, error: 'native failure' }).passed, false);
});
