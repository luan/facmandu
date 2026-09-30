import { z } from 'zod';

export const serverToolGroups = [
	'research',
	'production',
	'power',
	'logistics',
	'server',
	'watches',
	'planning'
] as const;
export const modlistToolGroups = ['inspect', 'discover', 'changes', 'server'] as const;
export type ServerToolGroup = (typeof serverToolGroups)[number];
export type ModlistToolGroup = (typeof modlistToolGroups)[number];
export type RecentAssistantTurn = { prompt: string; answer: string | null };

const noul = z.object({ noul: z.number().min(0).max(1) });
const intent = <const Choices extends readonly [string, ...string[]]>(choices: Choices) =>
	z.object({ choice: z.enum(choices), confidence: z.number().min(0).max(1) });

const serverAnswers = z.object({
	intent: intent(['status', 'question']),
	ambiguous: noul.optional(),
	research: noul.optional(),
	production: noul.optional(),
	power: noul.optional(),
	logistics: noul.optional(),
	server: noul.optional(),
	watches: noul.optional(),
	planning: noul.optional()
});
const modlistAnswers = z.object({
	intent: intent(['inspect', 'recommend', 'explain', 'change', 'question']),
	ambiguous: noul.optional(),
	inspect: noul.optional(),
	discover: noul.optional(),
	changes: noul.optional(),
	server: noul.optional()
});
export const serverRouteSchema = z.object({ answers: serverAnswers });
export const modlistRouteSchema = z.object({ answers: modlistAnswers });
export type ServerRoute = {
	intent: z.infer<typeof serverAnswers>['intent']['choice'];
	clarify: boolean;
	groups: ServerToolGroup[];
};
export type ModlistRoute = {
	intent: z.infer<typeof modlistAnswers>['intent']['choice'];
	clarify: boolean;
	groups: ModlistToolGroup[];
};

export const fallbackServerRoute = (): ServerRoute => ({
	intent: 'question',
	clarify: false,
	groups: [...serverToolGroups]
});
export const fallbackModlistRoute = (): ModlistRoute => ({
	intent: 'question',
	clarify: false,
	groups: [...modlistToolGroups]
});

function state(request: string, recent: readonly RecentAssistantTurn[]) {
	return {
		request,
		// The caller supplies turns from the current private chat only.
		recent: recent.slice(-4).map(({ prompt, answer }) => ({
			prompt: prompt.slice(0, 1000),
			answer: answer?.slice(0, 2000) ?? null
		}))
	};
}

const contextInstruction =
	'Use the current request and recent private conversation to resolve follow-ups such as "it" or "that". A question about performing an action is not an instruction to perform it. Select every relevant group for compound requests, including groups needed to read evidence before acting.';

const groupQuestion = (description: string) => ({
	type: 'noul' as const,
	instructions: `${contextInstruction} Is the ${description} tool group useful for this request?`
});
const ambiguityQuestion = {
	type: 'noul' as const,
	instructions: `${contextInstruction} Does an explicitly requested action need a missing preference or clarification before it can be prepared? Treat vague destructive requests as ambiguous.`
};

export function serverRouteBody(request: string, recent: readonly RecentAssistantTurn[] = []) {
	return {
		model: 'jev-latest',
		state: state(request, recent),
		questions: {
			intent: {
				type: 'choice' as const,
				instructions: `${contextInstruction} status means only a standalone request for running state and selected version. Factory state, advice, diagnosis, follow-ups and compound requests are question.`,
				criteria: {
					status: 'Current server running state and version only',
					question: 'Factory queries, diagnosis, advice, or other conversation'
				}
			},
			ambiguous: ambiguityQuestion,
			research: groupQuestion('game or mod research and explanations'),
			production: groupQuestion('factory production, recipes, machines or throughput'),
			power: groupQuestion('electric network, fuel or power production'),
			logistics: groupQuestion('belts, trains, robots, storage or item movement'),
			server: groupQuestion('server state, configuration, files, saves, logs or administration'),
			watches: groupQuestion('saved monitoring rules and alerts'),
			planning: groupQuestion('factory goals, tasks or plans')
		}
	};
}

export function modlistRouteBody(request: string, recent: readonly RecentAssistantTurn[] = []) {
	return {
		model: 'jev-latest',
		state: state(request, recent),
		questions: {
			intent: {
				type: 'choice' as const,
				instructions: `${contextInstruction} inspect means only simple current list status or counts. Advice, comparisons, conditional requests and multiple intents use another category.`,
				criteria: {
					inspect: 'Show current list status or mod counts only',
					recommend: 'Find suitable new mods',
					explain: 'Explain or compare particular mods in the list context',
					change:
						'Actually add, enable, disable, remove, icebox, lock, unlock, select a release, refresh metadata, dismiss or restore recommendations',
					question: 'Other, conversational or compound request'
				}
			},
			ambiguous: ambiguityQuestion,
			inspect: groupQuestion('current list inspection or particular installed mod details'),
			discover: groupQuestion(
				'mod discovery, ranked recommendations, dismissing or restoring suggested mods, candidate details, or the user’s other mod lists and preferences inferred from them'
			),
			changes: groupQuestion(
				'reviewing, preparing or applying explicitly requested list changes including locks, exact releases, metadata refresh, or recommendation dismissals'
			),
			server: groupQuestion(
				'creating a server or save from this mod list, inspecting server setup, or checking a requested setup status'
			)
		}
	};
}

function selectedGroups<Group extends string>(
	groups: readonly Group[],
	answers: { [Key in Group]?: { noul: number } }
): Group[] {
	// Missing or uncertain results keep every tool available to the agent.
	if (groups.some((group) => answers[group] === undefined)) return [...groups];
	const selected = groups.filter((group) => (answers[group]?.noul ?? 0) >= 0.7);
	return selected.length ? selected : [...groups];
}

export function serverRouteFromAnswers(data: unknown): ServerRoute {
	const parsed = serverRouteSchema.safeParse(data);
	if (!parsed.success || parsed.data.answers.intent.confidence < 0.95) return fallbackServerRoute();
	const { answers } = parsed.data;
	const groups = selectedGroups(serverToolGroups, answers);
	// A shortcut must not hide work suggested by other tool groups or a follow-up.
	const statusOnly =
		answers.intent.choice === 'status' &&
		(answers.ambiguous?.noul ?? 0) <= 0.3 &&
		serverToolGroups.every((group) => group === 'server' || (answers[group]?.noul ?? 0) < 0.7);
	return {
		intent: statusOnly ? 'status' : 'question',
		clarify: (answers.ambiguous?.noul ?? 0) > 0.7,
		groups
	};
}

export function modlistRouteFromAnswers(data: unknown): ModlistRoute {
	const parsed = modlistRouteSchema.safeParse(data);
	if (!parsed.success || parsed.data.answers.intent.confidence < 0.9) return fallbackModlistRoute();
	const { answers } = parsed.data;
	const groups = selectedGroups(modlistToolGroups, answers);
	const inspectOnly =
		answers.intent.choice === 'inspect' &&
		(answers.ambiguous?.noul ?? 0) <= 0.3 &&
		modlistToolGroups.every((group) => group === 'inspect' || (answers[group]?.noul ?? 0) < 0.7);
	return {
		intent:
			answers.intent.choice === 'inspect' && !inspectOnly ? 'question' : answers.intent.choice,
		clarify: (answers.ambiguous?.noul ?? 0) > 0.7,
		groups
	};
}
