import { z } from 'zod';
import { blueprintArtifactSchema } from './blueprints';

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
	display: z.boolean().optional(),
	result: z.unknown()
});
export type FactoryResult = z.infer<typeof factoryResultSchema>;

export function assistantMilestone(results: readonly FactoryResult[]) {
	const value = results.findLast((result) => result.tool === 'report_progress')?.result;
	return value &&
		typeof value === 'object' &&
		'message' in value &&
		typeof value.message === 'string'
		? value.message
		: '';
}

export function assistantTimeline(results: readonly FactoryResult[]) {
	const timeline: (
		| { kind: 'progress'; message: string }
		| { kind: 'tools'; items: FactoryResult[] }
	)[] = [];
	for (const item of results) {
		if (item.tool === 'report_progress') {
			const message = assistantMilestone([item]);
			const last = timeline.at(-1);
			if (message && !(last?.kind === 'progress' && last.message === message))
				timeline.push({ kind: 'progress', message });
		} else {
			const last = timeline.at(-1);
			if (last?.kind === 'tools') last.items.push(item);
			else timeline.push({ kind: 'tools', items: [item] });
		}
	}
	return timeline;
}

// A failed multi-product run must not hide earlier drafts behind the last small revision.
export function savedBlueprintDrafts(results: readonly FactoryResult[]) {
	const drafts = new Map<string, z.infer<typeof blueprintArtifactSchema>>();
	for (const result of results) {
		const parsed = blueprintArtifactSchema.safeParse(result.result);
		if (parsed.success) {
			drafts.delete(parsed.data.designId ?? parsed.data.blueprint);
			drafts.set(parsed.data.designId ?? parsed.data.blueprint, parsed.data);
		}
	}
	return [...drafts.values()];
}

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
