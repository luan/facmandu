import { error, json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
	type FactoryResult,
	factoryResultSchema,
	serverAssistantPlanSchema
} from '$lib/assistant-results';
import { chatHistory, newChat, resolveChat, touchChat } from '$lib/server/assistant-chats';
import { submissionEvents } from '$lib/server/assistant-events';
import { assistantModelCatalog } from '$lib/server/assistant-models';
import { authenticationForm, requireSameOrigin } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { genID } from '$lib/server/db/ids';
import { serverAssistantTurn as turnTable } from '$lib/server/db/schema';
import { agentHandle, routeServerRequest, watchCompaction } from '$lib/server/modlist-agent';
import { startModSync } from '$lib/server/server-mod-sync';
import { serverStatus } from '$lib/server/server-process';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

const state = globalThis as typeof globalThis & {
	__facmanduServerAssistantRequests?: Map<string, AbortController>;
};
state.__facmanduServerAssistantRequests ??= new Map();
const running = state.__facmanduServerAssistantRequests;
const keyOf = (userId: string, serverId: string) => `${userId}:${serverId}`;
async function finishTurn(
	turn: typeof turnTable.$inferSelect,
	controller: AbortController,
	send: (event: object) => void
) {
	const timeout = setTimeout(
		() => controller.abort(),
		Math.max(1, 180_000 - (Date.now() - turn.createdAt.getTime()))
	);
	const results: FactoryResult[] = [];
	const stopWatching = watchCompaction(turn.chatId ?? keyOf(turn.userId, turn.serverId), send);
	try {
		const recent = await db
			.select({ prompt: turnTable.prompt, answer: turnTable.answer })
			.from(turnTable)
			.where(
				and(
					eq(turnTable.userId, turn.userId),
					eq(turnTable.serverId, turn.serverId),
					eq(turnTable.chatId, turn.chatId ?? ''),
					eq(turnTable.state, 'done')
				)
			)
			.orderBy(desc(turnTable.createdAt))
			.limit(4);
		const route = !turn.receipt
			? await routeServerRequest(turn.userId, turn.serverId, turn.prompt, recent.reverse())
			: null;
		if (route?.intent === 'status' && !route.clarify) {
			if (controller.signal.aborted) throw new Error('Stopped');
			const server = await requireServer(turn.userId, turn.serverId);
			const status = await serverStatus(server);
			const answer = `${server.name}: ${status.running ? 'running' : 'stopped'}${status.version.version ? ` · Factorio ${status.version.version}` : ''}.`;
			results.push({
				kind: 'factory-result',
				tool: 'server_status',
				title: 'Server',
				result: { name: server.name, ...status }
			});
			await db
				.update(turnTable)
				.set({ state: 'done', answer, results: JSON.stringify(results) })
				.where(eq(turnTable.id, turn.id));
			send({ done: true, answer, results });
			return;
		}
		const { handle, context, effort } = await agentHandle(
			turn.userId,
			{ serverId: turn.serverId },
			turn.model ?? undefined,
			turn.effort ?? undefined,
			turn.chatId ?? undefined
		);
		const abort = () => {
			void handle.abort().catch(() => {});
		};
		controller.signal.addEventListener('abort', abort, { once: true });
		try {
			if (controller.signal.aborted) throw new Error('Stopped');
			const receipt =
				turn.receipt ??
				(
					await handle.dispatch({
						message: {
							kind: 'signal',
							type: 'facmandu-request',
							body: `${route?.clarify ? 'Clarify missing targets or preferences before making changes.\n' : ''}${turn.prompt}`,
							attributes: { groups: JSON.stringify(route?.groups ?? []), requestId: turn.id }
						},
						initialData: context,
						idempotencyKey: turn.id
					})
				).submissionId;
			await db
				.update(turnTable)
				.set({ receipt, model: context.model, effort })
				.where(eq(turnTable.id, turn.id));
			if (controller.signal.aborted) {
				abort();
				throw new Error('Stopped');
			}
			const result = await handle.read(receipt, {
				signal: controller.signal,
				onEvent: submissionEvents(receipt, (chunk) => {
					if (chunk.type === 'message-delta' && chunk.kind === 'text') send({ delta: chunk.delta });
					if (chunk.type === 'tool-input')
						send({
							progress:
								chunk.toolName === 'factory_action'
									? 'Updating factory…'
									: chunk.toolName === 'plan_production'
										? 'Calculating production…'
										: chunk.toolName === 'create_factory_watch'
											? 'Creating watch…'
											: chunk.toolName.startsWith('factory_')
												? 'Reading factory…'
												: 'Working…'
						});
					if (chunk.type === 'tool-output') {
						const parsed = factoryResultSchema.safeParse(chunk.output);
						if (parsed.success) {
							results.push(parsed.data);
							send({ results });
						}
					}
				})
			});
			await db
				.update(turnTable)
				.set({ state: 'done', answer: result.text, results: JSON.stringify(results) })
				.where(eq(turnTable.id, turn.id));
			send({ done: true, answer: result.text });
		} finally {
			controller.signal.removeEventListener('abort', abort);
		}
	} catch (cause) {
		console.error(
			'Server assistant failed:',
			cause instanceof Error ? cause.message.split('\n')[0]?.slice(0, 200) : 'Unknown error'
		);
		const answer = controller.signal.aborted
			? 'Response stopped.'
			: 'Could not finish this response. Try again.';
		await db
			.update(turnTable)
			.set({ state: 'error', answer, results: JSON.stringify(results) })
			.where(eq(turnTable.id, turn.id))
			.catch(() => {});
		send({ error: answer });
	} finally {
		stopWatching();
		clearTimeout(timeout);
		running.delete(turn.chatId ?? keyOf(turn.userId, turn.serverId));
	}
}
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Sign in');
	const server = await requireServer(locals.user.id, params.serverId);
	const target = { serverId: params.serverId };
	const chat = await resolveChat(locals.user.id, target, url.searchParams.get('chat'));
	const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get('offset')) || 0));
	const turns = await db
		.select()
		.from(turnTable)
		.where(
			and(
				eq(turnTable.userId, locals.user.id),
				eq(turnTable.serverId, server.id),
				eq(turnTable.chatId, chat.id)
			)
		)
		.orderBy(desc(turnTable.createdAt), desc(turnTable.id))
		.limit(31)
		.offset(offset);
	for (const turn of turns.filter((turn) => turn.state === 'running')) {
		const key = turn.chatId ?? keyOf(turn.userId, turn.serverId);
		if (!running.has(key)) {
			const controller = new AbortController();
			running.set(key, controller);
			void finishTurn(turn, controller, () => {}).catch(() => {});
		}
	}
	const catalog =
		url.searchParams.get('models') !== '0'
			? await assistantModelCatalog(locals.user.id)
					.then((models) => ({ models, modelError: '' }))
					.catch(() => ({
						models: [],
						modelError:
							'Could not load models. Check your Codex, Muse, or Copilot connection in Account settings.'
					}))
			: null;
	return json(
		{
			...catalog,
			chat,
			chats: await chatHistory(locals.user.id, target),
			hasMore: turns.length > 30,
			model:
				turns.find(
					(turn) =>
						turn.model && (!catalog || catalog.models.some((model) => model.id === turn.model))
				)?.model ??
				catalog?.models.find((model) => model.id.includes('luna'))?.id ??
				catalog?.models[0]?.id ??
				'',
			effort: turns.find((turn) => turn.effort)?.effort ?? '',
			turns: turns
				.slice(0, 30)
				.reverse()
				.map((turn) => ({ ...turn, mods: [], results: JSON.parse(turn.results) })),
			plans: []
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	requireSameOrigin(request, url);
	if (!locals.user) error(401, 'Sign in');
	const userId = locals.user.id;
	const server = await requireServer(userId, params.serverId);
	const input = await authenticationForm(request);

	const target = { serverId: server.id };
	if (input.get('operation') === 'new-chat') return json(await newChat(userId, target));
	const chat = await resolveChat(userId, target, String(input.get('chat') ?? '') || null);
	const operation = input.get('operation');
	const key = chat.id;
	if (operation === 'cancel') {
		running.get(key)?.abort();
		return json({ cancelled: true });
	}
	if (operation === 'apply-modlist') {
		if (running.has(key)) error(409, 'Finish the current response first');
		const saved = await db
			.select()
			.from(turnTable)
			.where(
				and(
					eq(turnTable.id, String(input.get('turn') ?? '')),
					eq(turnTable.userId, userId),
					eq(turnTable.serverId, server.id),
					eq(turnTable.chatId, chat.id),
					eq(turnTable.state, 'done')
				)
			)
			.get();
		if (!saved) error(404, 'Review not found');
		const results = z.array(factoryResultSchema).parse(JSON.parse(saved.results));
		const reviewed = results.find(
			(item) =>
				item.tool === 'prepare_server_mod_list' &&
				serverAssistantPlanSchema.safeParse(item.result).data?.hash === input.get('hash')
		);
		const plan = serverAssistantPlanSchema.safeParse(reviewed?.result);
		if (!plan.success || !reviewed) error(404, 'Review not found');
		if (plan.data.jobId) return json({ started: true });
		const outcome = await startModSync(server, userId, plan.data.listId, plan.data.hash);
		if ('error' in outcome) error(409, outcome.error);
		reviewed.result = { ...plan.data, jobId: outcome.job.id };
		await db
			.update(turnTable)
			.set({ results: JSON.stringify(results) })
			.where(eq(turnTable.id, saved.id));
		return json({ started: true });
	}
	const prompt = String(input.get('prompt') ?? '').trim();
	if (!prompt || prompt.length > 6000) error(400, 'Enter a question of up to 6,000 characters');
	const models = await assistantModelCatalog(userId).catch(() => []);
	const model = String(input.get('model') ?? '');
	const effort = String(input.get('effort') ?? '');
	const selected = models.find((item) => item.id === model);
	if (!selected || (effort && !selected.efforts.some((item) => item === effort)))
		error(400, 'Choose an available model and effort');
	if (running.has(key)) error(409, 'A response is already in progress');
	if (running.size >= 8) error(429, 'The assistant is busy. Try again shortly.');
	const controller = new AbortController();
	running.set(key, controller);
	const id = genID('turn');
	try {
		await touchChat(chat, prompt);
	} catch (cause) {
		running.delete(key);
		throw cause;
	}
	try {
		await db.insert(turnTable).values({
			id,
			userId,
			serverId: server.id,
			chatId: chat.id,
			prompt,
			model,
			effort,
			state: 'running',
			createdAt: new Date()
		});
	} catch (cause) {
		running.delete(key);
		throw cause;
	}
	const turn = await db.select().from(turnTable).where(eq(turnTable.id, id)).get();
	if (!turn) {
		running.delete(key);
		error(500, 'Could not save message');
	}
	const encoder = new TextEncoder();
	let closed = false;
	const disconnect = () => {
		closed = true;
		controller.abort();
	};
	const stream = new ReadableStream<Uint8Array>({
		start(output) {
			const send = (event: object) => {
				if (!closed) output.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			};
			request.signal.addEventListener('abort', disconnect, { once: true });
			send({ progress: 'Thinking…' });
			void finishTurn(turn, controller, send).finally(() => {
				request.signal.removeEventListener('abort', disconnect);
				if (!closed) {
					closed = true;
					output.close();
				}
			});
		},
		cancel: disconnect
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Cache-Control': 'no-store',
			'X-Accel-Buffering': 'no'
		}
	});
};
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		for (const controller of running.values()) controller.abort();
	});
