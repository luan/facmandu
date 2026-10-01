import { error, json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { factoryResultSchema, serverAssistantPlanSchema } from '$lib/assistant-results';
import { chatHistory, newChat, resolveChat, touchChat } from '$lib/server/assistant-chats';
import { assistantModelCatalog } from '$lib/server/assistant-models';
import { authenticationForm, requireSameOrigin } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { genID } from '$lib/server/db/ids';
import { serverAssistantTurn as turnTable } from '$lib/server/db/schema';
import { finishServerTurn, serverAssistantRequests } from '$lib/server/server-assistant';
import { startModSync } from '$lib/server/server-mod-sync';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

const running = serverAssistantRequests;
const keyOf = (userId: string, serverId: string) => `${userId}:${serverId}`;
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
		if (chat.gamePlayer) {
			if (!running.has(chat.id))
				await db
					.update(turnTable)
					.set({
						state: 'error',
						answer: 'This in-game request was interrupted. Ask again in game.'
					})
					.where(eq(turnTable.id, turn.id));
			continue;
		}
		const key = turn.chatId ?? keyOf(turn.userId, turn.serverId);
		if (!running.has(key)) {
			const controller = new AbortController();
			running.set(key, controller);
			void finishServerTurn(turn, controller, () => {}).catch(() => {});
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
	if (chat.gamePlayer) error(403, 'Reply to this conversation in game or start a new web chat');
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
			void finishServerTurn(turn, controller, send).finally(() => {
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
