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

export const factoryTaskSchema = z.object({
	id: z.string(),
	agent: z.literal('factory_surveyor'),
	label: z.string(),
	status: z.enum(['running', 'returned', 'failed', 'interrupted']),
	summary: z.string().optional(),
	error: z.string().optional()
});
export function assistantTaskStart(id: string, input: unknown): FactoryResult | null {
	const task = z
		.object({ agent: z.literal('factory_surveyor'), prompt: z.string() })
		.safeParse(input);
	return task.success
		? {
				kind: 'factory-result',
				tool: 'factory_task',
				title: 'Factory survey',
				display: false,
				result: {
					id,
					agent: task.data.agent,
					label: (task.data.prompt.split('\n')[0] ?? '').slice(0, 240),
					status: 'running'
				}
			}
		: null;
}
export function assistantTaskFinish(
	item: FactoryResult,
	output: unknown,
	error?: string,
	interrupted = false
) {
	const task = factoryTaskSchema.safeParse(item.result);
	if (item.tool !== 'factory_task' || !task.success) return;
	const blocks: unknown[] = Array.isArray(output)
		? output
		: output && typeof output === 'object' && 'content' in output && Array.isArray(output.content)
			? output.content
			: [];
	const text =
		typeof output === 'string'
			? output
			: blocks
					.flatMap((block) =>
						block &&
						typeof block === 'object' &&
						'type' in block &&
						block.type === 'text' &&
						'text' in block &&
						typeof block.text === 'string'
							? [block.text]
							: []
					)
					.join('\n');
	item.result = {
		...task.data,
		status: interrupted ? 'interrupted' : error ? 'failed' : 'returned',
		...(error ? { error: error.slice(0, 2000) } : { summary: text.slice(0, 2000) })
	};
}

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
