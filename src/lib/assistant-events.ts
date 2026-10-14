import type { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ConversationStreamChunk } from '@flue/runtime';
import { resultNumber } from './factory-results';

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
					progress = `Next: ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
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
	if (tool === 'task' && object(input)?.agent === 'factory_surveyor')
		return 'Surveying a supply chain…';
	if (tool === 'report_progress') return 'Updating you…';
	if (tool === 'factory_batch') {
		const afterSeconds = object(input)?.afterSeconds;
		if (typeof afterSeconds === 'number' && afterSeconds > 0 && afterSeconds <= 30)
			return `Waiting ${afterSeconds}s before the next factory check…`;
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
export function assistantToolFeedback(tool: string, output: unknown): string {
	const wrapper = object(output);
	const value = object(wrapper?.result) ?? wrapper;
	if (!value) return '';
	if (tool === 'factory_task')
		return `Factory survey ${typeof value.status === 'string' ? value.status : 'updated'}${typeof value.label === 'string' && value.label ? `: ${value.label}` : '.'}`;
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
	if (tool === 'search_blueprints' && Array.isArray(value.results))
		return `Found ${value.results.length} community designs; compatibility is not checked.`;
	if (tool === 'fetch_blueprint') {
		const blueprint = object(value.blueprint);
		const count = Array.isArray(blueprint?.entities) ? blueprint.entities.length : value.entities;
		if (typeof count === 'number')
			return `Retrieved community blueprint: ${count} entities. Not validated against this save.`;
		if (Array.isArray(value.entries))
			return `Retrieved blueprint book: ${value.total ?? value.entries.length} entries.`;
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
			const tiles = Array.isArray(value.tiles) ? value.tiles.length : value.tiles;
			const parts = [
				...(entities || !tiles ? [`${entities} ${entities === 1 ? 'entity' : 'entities'}`] : []),
				...(typeof tiles === 'number' && tiles > 0
					? [`${tiles} ${tiles === 1 ? 'tile' : 'tiles'}`]
					: [])
			];
			return `Draft validated: ${parts.join(', ')}${warnings ? `; ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}.`;
		}
	}
	if (tool === 'route_belts' && Array.isArray(value.results)) {
		const completed = value.results.filter((row: unknown) => object(row)?.found === true).length;
		const trapped = value.results.some(
			(row: unknown) => object(row)?.found === false && object(object(row)?.sourceExit)
		);
		const blocked = value.results.some(
			(row: unknown) => object(row)?.found === false && object(object(row)?.sourceBlocked)
		);
		return `Drafted ${completed} of ${value.results.length} belt connections.${blocked ? ' A start coordinate cannot accept a belt.' : ''}${trapped ? ' A start belt has no usable forward exit.' : ''} No construction placed.`;
	}
	if (tool === 'route_belt' || tool === 'belt_route') {
		if (value.found === false && object(value.sourceBlocked))
			return 'The start coordinate cannot accept a belt; inspect its footprint and terrain.';
		if (value.found === false && object(value.sourceExit))
			return 'The start belt has no usable forward exit; inspect its connection.';
		if (value.found === false) return 'No valid belt route found in the searched area.';
		if (typeof entities === 'number')
			return `Belt route drafted: ${entities} ${entities === 1 ? 'entity' : 'entities'}.`;
	}
	if (tool === 'factory_batch' && Array.isArray(value.results)) {
		const failed = value.results.filter((row: unknown) => object(row)?.ok === false).length;
		const facts = [
			...new Set(
				value.results.flatMap((row: unknown) => {
					const query = object(row);
					if (
						query?.ok !== true ||
						typeof query.tool !== 'string' ||
						query.tool === 'factory_batch'
					)
						return [];
					const fact = assistantToolFeedback(query.tool, query.result);
					return fact ? [fact] : [];
				})
			)
		].slice(0, 2);
		if (facts.length)
			return `${facts.join(' ')}${failed ? ` ${failed} ${failed === 1 ? 'query' : 'queries'} failed.` : ''}`;
		return `Completed ${value.results.length} factory queries${failed ? `; ${failed} failed` : ''}.`;
	}
	if (tool === 'item_rate' || tool === 'fluid_rate') {
		const product = value.item ?? value.fluid;
		const produced = resultNumber(value.produced_per_min);
		if (typeof product === 'string' && produced !== undefined)
			return `${product.replaceAll('_', ' ').replaceAll('-', ' ')}: ${Number(produced.toFixed(2))}/min produced${typeof value.surface === 'string' ? ` on ${value.surface}` : ''}.`;
	}
	if (tool === 'find_entities' && typeof value.total === 'number')
		return `Found ${value.total} matching entities${typeof value.surface === 'string' ? ` on ${value.surface}` : ''}${value.truncated ? ' in a partial scan' : ''}${typeof value.shown === 'number' && value.shown < value.total ? `; showing ${value.shown}` : ''}.`;
	if (tool === 'find_resource_patches' && typeof value.total_patches === 'number')
		return `Found ${value.total_patches} resource ${value.total_patches === 1 ? 'patch' : 'patches'} in charted terrain${value.truncated ? ' (partial scan)' : ''}.`;
	if (
		tool === 'planning_recipes' &&
		typeof value.enabled_total === 'number' &&
		typeof value.product === 'string'
	)
		return `${value.enabled_total} unlocked recipes for ${value.product.replaceAll('_', ' ').replaceAll('-', ' ')}${value.truncated ? '; catalog is partial' : ''}.`;
	if (['inspect_machine', 'inspect_transport'].includes(tool)) {
		if (value.found === false) return 'Target not found; refresh its location.';
		if (typeof value.name === 'string' && typeof value.status === 'string')
			return `${value.name.replaceAll('_', ' ').replaceAll('-', ' ')}: ${value.status.replaceAll('_', ' ')}.`;
	}
	if (
		tool === 'science_summary' &&
		Array.isArray(value.sciences) &&
		typeof object(value.research)?.active === 'boolean'
	)
		return `Read ${value.sciences.length} science production rates${value.truncated ? ' (partial snapshot)' : ''}; research ${object(value.research)?.active ? 'active' : 'idle'}. Rates do not prove delivery.`;
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
