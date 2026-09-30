export type Activity = {
	key: string;
	scope: 'server' | 'modlist';
	targetId: string;
	task?: string;
	download?: string;
	details?: string[];
	state: 'running' | 'done' | 'error';
	message: string;
	completed: number;
	total: number;
	updatedAt: number;
};
// Keep active work visible through development module reloads.
const processActivity = globalThis as typeof globalThis & {
	facmanduActivity?: {
		current: Map<string, Activity>;
		listeners: Set<(activity: Activity) => void>;
	};
};
processActivity.facmanduActivity ??= {
	current: new Map<string, Activity>(),
	listeners: new Set<(activity: Activity) => void>()
};
const { current, listeners } = processActivity.facmanduActivity;

export function publishActivity(activity: Omit<Activity, 'key' | 'updatedAt'>) {
	const key = `${activity.scope}:${activity.targetId}:${activity.task ?? 'repair'}`;
	const value = { ...activity, key, updatedAt: Date.now() };
	current.delete(key);
	current.set(key, value);
	if (current.size > 100) {
		const finished = [...current].find(([, item]) => item.state !== 'running');
		if (finished) current.delete(finished[0]);
	}
	for (const listener of listeners) listener(value);
}

export function subscribeActivity(
	accept: (activity: Activity) => boolean,
	listener: (activity: Activity) => void
) {
	const filtered = (activity: Activity) => {
		if (accept(activity)) listener(activity);
	};
	listeners.add(filtered);
	for (const activity of current.values()) filtered(activity);
	return () => listeners.delete(filtered);
}
