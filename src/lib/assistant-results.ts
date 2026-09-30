import { z } from 'zod';

export const assistantModsSchema = z.object({
	kind: z.literal('mods'),
	mods: z
		.array(
			z.object({
				name: z.string(),
				title: z.string(),
				summary: z.string(),
				reason: z.string(),
				thumbnail: z.string().nullable(),
				version: z.string().nullable(),
				factorioVersion: z.string(),
				enabled: z.boolean()
			})
		)
		.max(6)
});
export type AssistantMod = z.infer<typeof assistantModsSchema>['mods'][number];

export const factoryResultSchema = z.object({
	kind: z.literal('factory-result'),
	tool: z.string().optional(),
	title: z.string(),
	result: z.unknown()
});
export type FactoryResult = z.infer<typeof factoryResultSchema>;

export const serverAssistantPlanSchema = z.object({
	listId: z.string(),
	listName: z.string(),
	hash: z.string(),
	changes: z.array(
		z.object({
			kind: z.enum(['install', 'enable', 'disable']),
			name: z.string(),
			version: z.string().optional(),
			previous: z.array(z.string()).optional()
		})
	),
	problems: z.array(z.string()),
	desiredCount: z.number(),
	serverCount: z.number(),
	jobId: z.string().optional()
});
