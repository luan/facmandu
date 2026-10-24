import { z } from 'zod';
import type { FactoryLayoutJob } from '$lib/factory-layout';
import { aggregateLogisticsOutputs } from './factory-sandbox';

export function recyclingTrial(request: FactoryLayoutJob, pack: unknown) {
	const data = z
		.object({
			recipes: z.record(
				z.string(),
				z.object({
					stochastic: z.boolean().optional(),
					results: z.union([
						z.array(z.object({ name: z.string(), type: z.string() })),
						z.strictObject({}).transform(() => [])
					])
				})
			),
			plan: z.object({ lines: z.array(z.object({ recipe: z.string() })) }).optional()
		})
		.parse(pack);
	const line = data.plan?.lines[0];
	const recipe = line && data.recipes[line.recipe];
	if (
		data.plan?.lines.length !== 1 ||
		!recipe?.stochastic ||
		request.inputs.length !== 1 ||
		request.inputs[0]?.type === 'fluid' ||
		recipe.results.some((p) => p.type !== 'item') ||
		recipe.results.length !== request.outputs.length
	)
		return undefined;
	const ingredient = request.inputs[0];
	if (!ingredient) return undefined;
	if (
		recipe.results.some(
			(p) => p.name === ingredient.item || !request.outputs.some((o) => o.item === p.name)
		)
	)
		return undefined;
	return {
		ingredient: ingredient.item,
		targetPerMinute: ingredient.perMinute,
		products: recipe.results.map((p) => p.name)
	};
}

export function qualifyRecyclingTrial(
	value: unknown,
	recycling: NonNullable<ReturnType<typeof recyclingTrial>>
) {
	const result = aggregateLogisticsOutputs(value);
	const proof = z
		.object({
			recyclingProof: z.object({
				consumed: z.number().nonnegative(),
				ticks: z.number().positive(),
				products: z.record(z.string(), z.number().nonnegative())
			})
		})
		.parse(value).recyclingProof;
	const observations = z
		.object({
			simulatedTicks: z.number().positive(),
			outputs: z.array(
				z.object({ name: z.string(), perMinute: z.number(), targetPerMinute: z.number() })
			)
		})
		.parse(result);
	const delivered = observations.outputs;
	const perMinute = (proof.consumed * 3600) / proof.ticks;
	const observedProducts = delivered.map((p) => ({
		...p,
		produced: proof.products[p.name] ?? 0,
		collected: p.perMinute * (observations.simulatedTicks / 3600)
	}));
	const collected =
		observedProducts.length === recycling.products.length &&
		observedProducts.every((p) => p.produced >= 3 && p.collected >= p.produced * 0.95);
	const passed = proof.ticks >= 3600 && perMinute >= recycling.targetPerMinute * 0.95 && collected;
	return {
		...result,
		passed,
		verdict: passed ? 'passed' : 'inconclusive',
		qualification: 'recycling-input-throughput',
		observedProducts,
		outputs: [
			{
				name: recycling.ingredient,
				kind: 'item',
				measurement: 'consumed',
				perMinute,
				targetPerMinute: recycling.targetPerMinute,
				met: passed,
				sampleSufficient: proof.ticks >= 3600
			}
		],
		note: 'Recycling throughput is measured from scrap consumed. All products must be collected; their random yields are observations, not guaranteed individual rates.'
	};
}
