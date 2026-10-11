export type AssistantContextUsage = {
	model: string;
	tokens: number | null;
	window: number;
	reserve: number;
	compactionFailed: boolean;
	compacting: boolean;
};

export function assistantContextLimit(
	model: string,
	window: number,
	maxTokens: number
): AssistantContextUsage {
	let reserve = Math.min(20_000, maxTokens > 0 ? maxTokens : 20_000);
	if (window > 0 && reserve * 2 >= window) reserve = Math.max(1024, Math.floor(window / 3));
	// Large advertised windows need not keep hundreds of thousands of routine
	// lookup tokens. Summarize above 64k; full chat and native drafts stay durable.
	if (window > 64_000) reserve = Math.max(reserve, window - 64_000);
	return { model, tokens: null, window, reserve, compactionFailed: false, compacting: false };
}

// Occupancy of the latest request, including cached input; never cumulative spend.
export function assistantContextTokens(usage: {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
}) {
	const tokens =
		usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}
