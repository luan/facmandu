import { useDelivery, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';

// Routing narrows the model's menu, never its authorization. A tool can be loaded
// mid-response when investigation crosses into another domain.
export function useAssistantToolGroups(allowed: readonly [string, ...string[]]) {
	const delivery = useDelivery();
	const requestId = delivery.kind === 'signal' ? (delivery.attributes?.requestId ?? '') : '';
	let selected: string[] = [...allowed];
	if (delivery.kind === 'signal' && delivery.type === 'facmandu-request') {
		try {
			const groups: unknown = JSON.parse(delivery.attributes?.groups ?? 'null');
			if (
				Array.isArray(groups) &&
				groups.length &&
				groups.every((group) => typeof group === 'string' && allowed.includes(group))
			)
				selected = groups;
		} catch {
			/* Older deliveries keep the complete menu. */
		}
	}
	const [expanded, setExpanded] = usePersistentState<{ requestId: string; groups: string[] }>(
		'tool-groups',
		{ requestId: '', groups: [] }
	);
	const groups = new Set([
		...selected,
		...(expanded.requestId === requestId ? expanded.groups : [])
	]);
	useTool({
		name: 'load_tools',
		description: `Load additional capabilities for this request. Available groups: ${allowed.join(', ')}. Use when the current tools cannot complete the request. This does not perform an action.`,
		input: v.object({
			groups: v.pipe(v.array(v.picklist(allowed)), v.minLength(1), v.maxLength(allowed.length))
		}),
		run({ data }) {
			const added = [...new Set([...groups, ...data.groups])];
			setExpanded({ requestId, groups: added });
			return { output: { available: added } };
		}
	});
	return groups;
}
