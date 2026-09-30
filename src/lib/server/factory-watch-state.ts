export const WATCH_POLL_MS = 60_000;
const STALL_MS = 5 * 60_000;

type ResearchSample = {
	lastSampledAt: Date | null;
	lastChangedAt: Date | null;
	lastResearch: string | null;
	lastProgress: number | null;
	alerting: boolean;
};

export function nextResearchState(
	previous: ResearchSample,
	subject: string | null,
	progress: number | null,
	now: Date
) {
	if (subject === null || progress === null)
		return {
			lastSampledAt: now,
			lastChangedAt: null,
			lastResearch: null,
			lastProgress: null,
			alerting: false,
			notify: false
		};
	const changed =
		previous.lastResearch !== subject ||
		previous.lastProgress !== progress ||
		!previous.lastChangedAt ||
		(previous.lastSampledAt !== null &&
			now.getTime() - previous.lastSampledAt.getTime() > WATCH_POLL_MS * 3);
	const lastChangedAt = !changed && previous.lastChangedAt ? previous.lastChangedAt : now;
	const alerting = !changed && now.getTime() - lastChangedAt.getTime() >= STALL_MS;
	return {
		lastSampledAt: now,
		lastChangedAt,
		lastResearch: subject,
		lastProgress: progress,
		alerting,
		notify: alerting && !previous.alerting
	};
}

export function nextDeficitState(produced: number, consumed: number, wasAlerting: boolean) {
	const alerting = consumed > produced;
	return { alerting, notify: alerting && !wasAlerting };
}
