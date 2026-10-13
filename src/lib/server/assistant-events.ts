import type { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ConversationStreamChunk } from '@flue/runtime';

// Large blueprint arguments stream before Flue can emit a complete tool-input.
export function assistantStreamProgress(
	stream: AssistantMessageEventStream,
	send: (progress: string) => void
) {
	const iterator = stream[Symbol.asyncIterator].bind(stream);
	stream[Symbol.asyncIterator] = async function* () {
		let previous = '';
		for await (const event of { [Symbol.asyncIterator]: iterator }) {
			let progress = '';
			if (event.type === 'thinking_start') progress = 'Reasoning…';
			if (event.type === 'text_start') progress = 'Responding…';
			if (event.type === 'toolcall_start' || event.type === 'toolcall_delta') {
				const block = event.partial.content[event.contentIndex];
				if (block?.type === 'toolCall') {
					const label = assistantToolProgress(block.name, block.arguments);
					progress = `Preparing ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
				}
			}
			if (progress && progress !== previous) {
				previous = progress;
				send(progress);
			}
			yield event;
		}
	};
	return stream;
}

export function assistantToolProgress(tool: string, input: unknown) {
	if (tool === 'report_progress') return 'Updating you…';
	if (tool === 'factory_batch') {
		const queries = object(input)?.queries;
		const names = Array.isArray(queries)
			? [
					...new Set(
						queries.flatMap((query: unknown) => {
							const name = object(query)?.tool;
							return typeof name === 'string' ? [name.replaceAll('_', ' ')] : [];
						})
					)
				]
			: [];
		return names.length
			? `Inspecting factory: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : '…'}`
			: 'Inspecting factory…';
	}
	const name =
		input &&
		typeof input === 'object' &&
		'operation' in input &&
		typeof input.operation === 'string'
			? input.operation
			: input && typeof input === 'object' && 'tool' in input && typeof input.tool === 'string'
				? input.tool
				: '';
	const operation = name.replaceAll('_', ' ');
	if (tool === 'blueprint_operation') {
		const args = object(object(input)?.args);
		if (name === 'create' && args) {
			const edits = Array.isArray(args.entityChanges) ? args.entityChanges.length : 0;
			const entities =
				[args.entities, args.addedEntities].reduce<number>(
					(sum, items) => sum + (Array.isArray(items) ? items.length : 0),
					0
				) +
				[args.entityRows, args.addedEntityRows].reduce<number>(
					(sum, rows) =>
						sum +
						(Array.isArray(rows)
							? rows.reduce<number>((total, row: unknown) => {
									const count = object(row)?.count;
									return total + (typeof count === 'number' && Number.isFinite(count) ? count : 0);
								}, 0)
							: 0),
					0
				);
			if (edits) return `Drafting blueprint: ${edits} entity edits described…`;
			if (entities) return `Drafting blueprint: ${entities} entities described…`;
		}
		return `Blueprint${operation ? `: ${operation}` : ''}…`;
	}
	if (tool === 'factory_action') return `Factory action${operation ? `: ${operation}` : ''}…`;
	if (tool === 'factory_plan') return `Factory plan${operation ? `: ${operation}` : ''}…`;
	if (tool === 'solve_factory_plan') return 'Solving native production plan…';
	if (tool.startsWith('factory_')) return `Inspecting factory${operation ? `: ${operation}` : ''}…`;
	if (tool === 'plan_production') return 'Calculating production…';
	if (tool === 'render_blueprint') return 'Rendering blueprint…';
	if (tool === 'sandbox_blueprint') return 'Testing blueprint…';
	return `${tool.replaceAll('_', ' ')}…`;
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

// Completed tool facts stay visible while the next model call is thinking.
// Describe evidence, never infer construction or throughput from an exported draft.
export function assistantToolFeedback(tool: string, output: unknown) {
	const wrapper = object(output);
	const value = object(wrapper?.result) ?? wrapper;
	if (!value) return '';
	if (tool === 'factory_plan' || tool === 'solve_factory_plan' || tool === 'planner_calculation') {
		if (Array.isArray(value.plans))
			return `Found ${value.plans.length} shared factory plans${value.truncated ? ' (more available)' : ''}.`;
		if (typeof value.reference === 'string')
			return `Factory plan ${value.reference} · ${typeof value.status === 'string' ? value.status : 'saved'}.`;
		if (typeof value.status === 'string')
			return `Native solver: ${value.status}. Production remains unmeasured.`;
	}
	if (tool === 'report_progress' && typeof value.message === 'string') return value.message;
	if (typeof value.error === 'string') {
		if (/overlap/i.test(value.error)) return 'Layout validation found overlapping entities.';
		return `${tool.replaceAll('_', ' ')} failed; expand the tool step for details.`;
	}
	if (
		value.operation === 'place_blueprint' &&
		typeof value.placed === 'number' &&
		typeof value.requested === 'number'
	) {
		const tiles = value.placed_tiles;
		const requestedTiles = value.requested_tiles;
		if (typeof tiles === 'number' && typeof requestedTiles === 'number' && requestedTiles > 0) {
			const entities = value.requested
				? `${value.placed} of ${value.requested} entity ghosts and `
				: '';
			return `Placed ${entities}${tiles} of ${requestedTiles} tile ghosts. Real items are required to build them.`;
		}
		return `Placed ${value.placed} of ${value.requested} construction ghosts. Real items are required to build them.`;
	}
	if (
		value.operation === 'check_build' &&
		typeof value.constructed === 'number' &&
		typeof value.requested === 'number'
	) {
		const machines = Array.isArray(value.machines) ? value.machines : [];
		const working = machines.filter(
			(machine: unknown) => object(machine)?.status === 'working'
		).length;
		const delivery =
			object(value.measurement)?.measured === true
				? 'Delivery measurement available.'
				: 'Delivery rate remains unmeasured.';
		return `Built ${value.constructed} of ${value.requested} entities${working ? `; ${working} ${working === 1 ? 'machine' : 'machines'} working` : ''}. ${delivery}`;
	}
	const entities = Array.isArray(value.entities) ? value.entities.length : value.entities;
	if (tool === 'blueprint_operation') {
		if (typeof value.ready === 'boolean') {
			const blocked = Array.isArray(value.blocked) ? value.blocked.length : 0;
			const power = object(value.power);
			const gaps = [power?.uncovered_total, power?.unconnected_total].reduce<number>(
				(sum, count) => sum + (typeof count === 'number' ? count : 0),
				0
			);
			return `Placement check: ${blocked ? `${blocked} blocked ${blocked === 1 ? 'position' : 'positions'}` : 'no blocked positions'}${gaps ? `; ${gaps} planned power gaps` : ''}.`;
		}
		if (
			typeof entities === 'number' &&
			(value.importValidated === true || typeof value.blueprint === 'string')
		) {
			const warnings = Array.isArray(value.warnings) ? value.warnings.length : 0;
			return `Draft validated: ${entities} ${entities === 1 ? 'entity' : 'entities'}${warnings ? `; ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}.`;
		}
	}
	if (tool === 'route_belt') {
		if (value.found === false) return 'No valid belt route found in the searched area.';
		if (typeof entities === 'number')
			return `Belt route drafted: ${entities} ${entities === 1 ? 'entity' : 'entities'}.`;
	}
	if (tool === 'factory_batch' && Array.isArray(value.results)) {
		const failed = value.results.filter((row: unknown) => object(row)?.ok === false).length;
		return `Completed ${value.results.length} factory queries${failed ? `; ${failed} failed` : ''}.`;
	}
	if (tool === 'server_status' && typeof value.running === 'boolean')
		return `Server checked: ${value.running ? 'running' : 'stopped'}.`;
	return '';
}

export function assistantElapsed(progress: string, started: number, now: number) {
	const seconds = Math.max(0, Math.floor((now - started) / 1000));
	return `${progress} · ${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
}
// Flue replays the conversation stream. Forward only this submission's messages and tools.
export function submissionEvents(id: string, accept: (chunk: ConversationStreamChunk) => void) {
	const messages = new Set<string>();
	const tools = new Set<string>();
	return (chunk: ConversationStreamChunk) => {
		if (chunk.type === 'message-started' && chunk.submissionId === id)
			messages.add(chunk.messageId);
		if ('messageId' in chunk && messages.has(chunk.messageId)) {
			if (chunk.type === 'tool-input') tools.add(chunk.toolCallId);
			accept(chunk);
		} else if ('toolCallId' in chunk && tools.has(chunk.toolCallId)) accept(chunk);
	};
}

// Tool-call preambles are progress, not part of the final player-facing answer.
export function assistantPreamble(previous: string | undefined, chunk: ConversationStreamChunk) {
	return chunk.type === 'tool-input' && previous?.trim() ? previous.trim() : undefined;
}

export function assistantText(previous: string | undefined, chunk: ConversationStreamChunk) {
	if (chunk.type === 'message-started' || chunk.type === 'tool-input') return '';
	if (chunk.type === 'message-delta' && chunk.kind === 'text')
		return (previous ?? '') + chunk.delta;
	return previous;
}

// Recovery and completion review can emit several drafts in one coalesced reply.
export function assistantFinalText(
	reply: { text: string; data: Record<string, unknown> },
	streamed?: string
) {
	const answers = reply.data['assistant-answer'];
	const accepted = Array.isArray(answers) ? answers.at(-1) : undefined;
	return typeof accepted === 'string' ? accepted : (streamed ?? reply.text);
}
