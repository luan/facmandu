import { assistantTimeline, factoryResultSchema } from './assistant-results';
import { blueprintArtifactSchema } from './blueprints';
import { factoryPreviewPendingSchema, factoryViewSchema } from './factory-images';
import { gameText } from './game-chat';
import { assistantToolFeedback } from './server/assistant-events';

function results(value: string) {
	try {
		const data: unknown = JSON.parse(value);
		return Array.isArray(data)
			? data.flatMap((entry) => {
					const parsed = factoryResultSchema.safeParse(entry);
					return parsed.success ? [parsed.data] : [];
				})
			: [];
	} catch {
		return [];
	}
}

export function panelDesign(value: string) {
	for (const result of results(value).toReversed()) {
		const blueprint = blueprintArtifactSchema.safeParse(result.result);
		if (blueprint.success && blueprint.data.blueprint.length <= 65536)
			return {
				blueprint: blueprint.data.blueprint,
				label: blueprint.data.label,
				stage: result.display ? 'Design' : 'Working draft',
				cost: blueprint.data.cost,
				warnings: blueprint.data.warnings
			};
		const snapshot = factoryViewSchema.or(factoryPreviewPendingSchema).safeParse(result.result);
		if (snapshot.success && snapshot.data.blueprint && snapshot.data.blueprint.length <= 65536)
			return {
				blueprint: snapshot.data.blueprint,
				label: `Existing factory · ${snapshot.data.surface}`,
				stage: 'Inspection',
				cost: snapshot.data.cost ?? [],
				warnings: [] as string[]
			};
	}
	return undefined;
}

export function panelActivity(value: string, progress?: string, feedback?: string) {
	const rows = results(value)
		.slice(-14)
		.map((result) => {
			const detail = assistantToolFeedback(result.tool ?? '', result);
			const error = factoryError(result.result);
			return {
				text: gameText([result.title, error ?? detail].filter(Boolean).join('\n'), 700)
			};
		});
	if (progress || feedback)
		rows.push({ text: gameText([progress, feedback].filter(Boolean).join('\n'), 700) });
	return rows;
}

export function panelUpdates(value: string) {
	return assistantTimeline(results(value))
		.flatMap((entry) => (entry.kind === 'progress' ? [entry.message] : []))
		.slice(-4);
}
function factoryError(value: unknown) {
	if (!value || typeof value !== 'object' || !('error' in value)) return undefined;
	return typeof value.error === 'string' ? value.error : undefined;
}

// Only public tool progress drives the companion; private model reasoning is never spoken.
export function panelDrone(running: boolean, progress: string, feedback: string, failed: boolean) {
	const phase = failed
		? 'error'
		: !running
			? 'idle'
			: /draft|blueprint|route|construct|place|render/i.test(progress)
				? 'working'
				: /inspect|query|check|catalog|read|search/i.test(progress)
					? 'inspecting'
					: 'thinking';
	return {
		phase,
		message: gameText(
			running
				? feedback || progress
				: failed
					? 'The response failed. Open Activity for details.'
					: '',
			240
		)
	};
}
