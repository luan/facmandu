import { z } from 'zod';

// Public beta supports Luna only; change this when Decisions adds another model.
export const decisionsModel = 'gpt-6-luna';
export type DecisionQuestion = { name: string; instructions: string } & (
	| { type: 'predicate' }
	| { type: 'choice'; choices: { value: string | boolean; description?: string }[] }
	| { type: 'score'; levels: { label: string; description?: string }[] }
);
export type DecisionRequest = {
	model: typeof decisionsModel;
	input: string;
	questions: DecisionQuestion[];
};

const probability = z.number().min(0).max(1);
const name = z.string().min(1);
export const decisionResponseSchema = z.object({
	answers: z
		.array(
			z.discriminatedUnion('type', [
				z.object({ name, type: z.literal('predicate'), probability }),
				z.object({
					name,
					type: z.literal('choice'),
					choice: z.union([z.string(), z.boolean()]),
					confidence: probability
				}),
				z.object({ name, type: z.literal('score'), score: z.number(), confidence: probability }),
				z.object({ name, type: z.literal('refusal') })
			])
		)
		.refine(
			(answers) => new Set(answers.map((answer) => answer.name)).size === answers.length,
			'Duplicate decision answers'
		)
});
