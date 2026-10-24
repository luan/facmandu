import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { factoryLayoutJobInput } from '../src/lib/factory-layout';
import { qualifyRecyclingTrial, recyclingTrial } from '../src/lib/server/factory-recycling-trial';

const fixture = JSON.parse(
	readFileSync('tests/fixtures/interpose/scrap-recycling-2.1.21.json', 'utf8')
);
const spec = recyclingTrial(factoryLayoutJobInput.parse(fixture.request), fixture.pack);
assert.ok(spec);
const receipt = {
	status: 'done',
	id: 'native',
	passed: false,
	simulatedTicks: 7200,
	recyclingProof: {
		consumed: 1800,
		ticks: 7200,
		products: Object.fromEntries(spec.products.map((n) => [n, 15]))
	},
	outputs: spec.products.map((name) => ({
		name,
		kind: 'item',
		perMinute: 7.5,
		targetPerMinute: 9,
		met: false,
		sampleSufficient: true
	}))
};
test('random yields qualify actual input throughput and collection, without inventing fixed product rates', () => {
	const result = qualifyRecyclingTrial(receipt, spec);
	assert.equal(result.passed, true);
	assert.equal(result.outputs[0]?.perMinute, 900);
	assert.equal(result.observedProducts.length, 13);
	assert.equal(
		qualifyRecyclingTrial(
			{ ...receipt, recyclingProof: { ...receipt.recyclingProof, consumed: 900 } },
			spec
		).passed,
		false
	);
	assert.equal(
		qualifyRecyclingTrial(
			{
				...receipt,
				outputs: receipt.outputs.map((p, i) => (i === 0 ? { ...p, perMinute: 0 } : p))
			},
			spec
		).passed,
		false
	);
	assert.equal(
		qualifyRecyclingTrial(
			{ ...receipt, recyclingProof: { ...receipt.recyclingProof, ticks: 60, consumed: 15 } },
			spec
		).passed,
		false
	);
	assert.equal(
		recyclingTrial(factoryLayoutJobInput.parse(fixture.request), {
			...fixture.pack,
			recipes: {
				...fixture.pack.recipes,
				'scrap-recycling': { ...fixture.pack.recipes['scrap-recycling'], stochastic: false }
			}
		}),
		undefined
	);
});
