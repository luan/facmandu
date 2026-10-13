import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { assistantMilestone } from '$lib/assistant-results';
import { gamePanelText, gameReply, gameText, parseGameChat, parseGameUi } from '$lib/game-chat';
import { panelActivity, panelDesign, panelDrone, panelUpdates } from '$lib/toby-panel';
import { routeAmbientChat } from './ambient-chat';
import { touchChat } from './assistant-chats';
import { db } from './db';
import { genID } from './db/ids';
import { assistantChat, type ManagedServer, managedServer, serverAssistantTurn } from './db/schema';
import { forceChatScope } from './game-chat-scope';
import { requireGamePlayer } from './game-player';
import {
	finishServerTurn,
	serverAssistantActivity,
	serverAssistantController,
	serverAssistantRequests,
	steerServerTurn
} from './server-assistant';
import { type GameAssistantConfig, serverConfig } from './server-files';
import { type LogLine, subscribeLogs } from './server-logs';
import { rconScript } from './server-rcon';
import { canManageServer } from './servers';

type GameMessage = {
	player: string;
	prompt: string;
	ambient?: true;
	chatId?: string;
	fresh?: boolean;
	panel?: true;
};
type Session = {
	stop: () => void;
	controllers: Set<AbortController>;
	config: GameAssistantConfig;
	fingerprint: string;
	pending: Map<string, { chat: Promise<string | null>; done: Promise<void> }>;
	recent: number[];
	ambientRecent: number[];
	routing: Set<string>;
	uiRecent: number[];
	panels: Map<string, string>;
	players: Map<string, number>;
};
const sessions = new Map<string, Session>();
let timer: ReturnType<typeof setInterval> | undefined;
let scanning: Promise<void> | undefined;

async function reply(server: ManagedServer, player: string, answer: string, sourceChat?: string) {
	for (const text of gameReply(answer))
		await rconScript(
			server,
			`/silent-command local p=game.get_player(${JSON.stringify(player)}); if p and p.connected then p.force.print(${JSON.stringify(`Toby: ${text}`)}) end`
		);
	const session = sessions.get(server.id);
	if (session) await syncForcePanels(server, session, player, sourceChat);
}
async function syncForcePanels(
	server: ManagedServer,
	session: Session,
	player: string,
	sourceChat?: string
) {
	// Each snapshot rechecks the viewer's current native force before reading history.
	await Promise.allSettled(
		[...new Set([player, ...session.panels.keys()])].map((viewer) =>
			syncPanel(server, session, viewer, undefined, undefined, sourceChat)
		)
	);
}
async function syncPanel(
	server: ManagedServer,
	session: Session,
	player: string,
	selected?: string,
	progress?: string,
	sourceChat?: string
) {
	const { player: author } = await requireGamePlayer(server, session.config.ownerId, player);
	const chats = await db
		.select()
		.from(assistantChat)
		.where(
			and(
				eq(assistantChat.userId, session.config.ownerId),
				eq(assistantChat.serverId, server.id),
				forceChatScope(author)
			)
		)
		.orderBy(desc(assistantChat.updatedAt))
		.limit(8);
	const chatRows = await Promise.all(
		chats.map(async (chat) => {
			const latest = await db
				.select()
				.from(serverAssistantTurn)
				.where(eq(serverAssistantTurn.chatId, chat.id))
				.orderBy(desc(serverAssistantTurn.createdAt))
				.get();
			const active = latest && serverAssistantActivity.get(latest.id);
			return {
				id: chat.id,
				title: gameText(chat.title, 200),
				state: latest?.state ?? 'idle',
				status: gameText(
					active?.feedback ||
						active?.progress ||
						latest?.answer ||
						(latest?.state === 'running' ? 'Working…' : 'Ready'),
					500
				),
				author: latest?.gamePlayer ?? chat.gamePlayer ?? undefined
			};
		})
	);
	const current =
		chats.find((chat) => chat.id === (selected ?? session.panels.get(player))) ?? chats[0];
	if (current) session.panels.set(player, current.id);
	const turns = current
		? await db
				.select()
				.from(serverAssistantTurn)
				.where(eq(serverAssistantTurn.chatId, current.id))
				.orderBy(desc(serverAssistantTurn.createdAt))
				.limit(8)
		: [];
	const turnsWithActivity = turns.map((turn) => {
		const activity = serverAssistantActivity.get(turn.id);
		return activity
			? {
					...turn,
					answer: activity.answer || assistantMilestone(activity.results),
					results: JSON.stringify(activity.results)
				}
			: turn;
	});
	const turn = turnsWithActivity[0];
	const activity = turn && serverAssistantActivity.get(turn.id);
	const messages: { role: 'user' | 'assistant'; text: string; author?: string }[] = [];
	let available = 12000;
	for (const entry of turnsWithActivity) {
		const answer = gamePanelText(entry.answer, Math.min(6000, available));
		available -= Buffer.byteLength(answer);
		const prompt = gamePanelText(entry.prompt, Math.min(2000, available));
		available -= Buffer.byteLength(prompt);
		if (answer) messages.unshift({ role: 'assistant', text: answer });
		for (const update of panelUpdates(entry.results).toReversed()) {
			if (update === entry.answer) continue;
			const text = gamePanelText(update, Math.min(600, available));
			available -= Buffer.byteLength(text);
			if (text) messages.unshift({ role: 'assistant', text });
		}
		if (prompt)
			messages.unshift({
				role: 'user',
				author: entry.gamePlayer ?? current?.gamePlayer ?? 'Player',
				text: `${entry.gamePlayer ?? current?.gamePlayer ?? 'Player'}: ${prompt}`
			});
		if (!available) break;
	}
	const design = turnsWithActivity
		.map((entry) => panelDesign(entry.results))
		.find((entry) => entry);
	const state = {
		current: current?.id,
		status: gameText(
			[
				(!sourceChat || sourceChat === current?.id
					? progress && gameText(progress, 500)
					: undefined) ??
					activity?.progress ??
					(turn?.state === 'running' ? 'Working…' : 'Ready'),
				activity?.feedback
			]
				.filter(Boolean)
				.join(' '),
			500
		),
		answer: gamePanelText(turn?.answer ?? '', 6000),
		running: turn?.state === 'running',
		// Native Toby accepts at most 16 rows; keep the newest messages within its wire contract.
		messages: messages.slice(-16),
		activity: panelActivity(turn?.results ?? '[]', activity?.progress, activity?.feedback),
		drone: panelDrone(
			turn?.state === 'running',
			activity?.progress ?? 'Thinking…',
			activity?.feedback ?? '',
			turn?.state === 'error'
		),
		designStage: design?.stage,
		designWarnings: design?.warnings.slice(0, 8).map((warning) => gameText(warning, 400)),
		blueprint: design?.blueprint,
		design: design && gameText(design.label, 200),
		materials: design?.cost.slice(0, 32).map((item) => ({ ...item, count: Math.ceil(item.count) })),
		chats: chatRows
	};
	if (sessions.get(server.id) !== session) return;
	const encoded = JSON.stringify(JSON.stringify(state));
	// Keep the legacy click handler while installed clients still have the text launcher.
	// Remove this replacement once the minimum supported mod has its native icon.
	await rconScript(
		server,
		`/silent-command local p=game.get_player(${JSON.stringify(player)}); local i=remote.interfaces['facmandu-assistant']; if p and p.connected and i and i.update_player then local b=p.gui.top['facmandu-toby-open']; if b and b.type=='button' and helpers.is_valid_sprite_path('entity/toby-drone') then local index=b.get_index_in_parent(); b.destroy(); local icon=p.gui.top.add{type='sprite-button',name='facmandu-toby-open',sprite='entity/toby-drone',style='slot_button',tooltip='Open Toby · Ctrl+Shift+T'}; if index~=icon.get_index_in_parent() then p.gui.top.swap_children(index,icon.get_index_in_parent()) end end; remote.call('facmandu-assistant','update_player',p.index,helpers.json_to_table(${encoded})) end`
	);
}
async function receiveUi(
	server: ManagedServer,
	session: Session,
	line: LogLine,
	message: NonNullable<ReturnType<typeof parseGameUi>>
) {
	const { player: author } = await requireGamePlayer(
		server,
		session.config.ownerId,
		message.player
	);
	if (sessions.get(server.id) !== session) return;
	if (message.chat) {
		const allowed = await db
			.select()
			.from(assistantChat)
			.where(
				and(
					eq(assistantChat.id, message.chat),
					eq(assistantChat.userId, session.config.ownerId),
					eq(assistantChat.serverId, server.id),
					forceChatScope(author)
				)
			)
			.get();
		if (!allowed) return;
	}
	if (message.operation === 'refresh' || message.operation === 'select') {
		await syncPanel(server, session, message.player, message.chat);
		return;
	}
	if (message.operation === 'new') {
		const chat = await chatFor(server, session.config.ownerId, message.player, true);
		await syncPanel(server, session, message.player, chat.id);
		return;
	}
	if (message.operation === 'stop') {
		const chat = message.chat ?? (await session.pending.get(message.player)?.chat);
		if (chat) serverAssistantRequests.get(chat)?.abort();
		await syncPanel(server, session, message.player, chat ?? undefined, 'Stopped');
		return;
	}
	if (message.operation === 'send' && message.prompt)
		admit(server, session, line, {
			player: message.player,
			prompt: message.prompt,
			chatId: message.chat,
			panel: true
		});
}
async function chatFor(server: ManagedServer, ownerId: string, player: string, fresh = false) {
	const { player: author } = await requireGamePlayer(server, ownerId, player);
	const existing = !fresh
		? await db
				.select()
				.from(assistantChat)
				.where(
					and(
						eq(assistantChat.userId, ownerId),
						eq(assistantChat.serverId, server.id),
						forceChatScope(author)
					)
				)
				.orderBy(desc(assistantChat.updatedAt), desc(assistantChat.id))
				.get()
		: null;
	if (existing) {
		// Only its original author can expose an unscoped legacy conversation.
		if (!existing.gameForce) {
			await db
				.update(assistantChat)
				.set({ gameForce: author.force })
				.where(eq(assistantChat.id, existing.id));
			return { ...existing, gameForce: author.force };
		}
		return existing;
	}
	const chat = {
		id: genID('chat'),
		userId: ownerId,
		serverId: server.id,
		gamePlayer: player,
		gameForce: author.force,
		title: `In game · ${player}`,
		createdAt: new Date(),
		updatedAt: new Date()
	};
	await db.insert(assistantChat).values(chat);
	return chat;
}
async function answer(
	server: ManagedServer,
	session: Session,
	line: LogLine,
	message: GameMessage,
	ready: (chat: string | null) => void
) {
	const ownerId = session.config.ownerId;
	const { player: author } = await requireGamePlayer(server, ownerId, message.player);
	if (sessions.get(server.id) !== session) return;
	if (/^(?:new|new chat|start fresh)$/iu.test(message.prompt)) {
		const chat = await chatFor(server, ownerId, message.player, true);
		await syncPanel(server, session, message.player, chat.id);
		await reply(server, message.player, 'Started a new chat.', chat.id);
		return;
	}
	const chat = message.chatId
		? await db
				.select()
				.from(assistantChat)
				.where(
					and(
						eq(assistantChat.id, message.chatId),
						eq(assistantChat.userId, ownerId),
						eq(assistantChat.serverId, server.id),
						forceChatScope(author)
					)
				)
				.get()
		: await chatFor(server, ownerId, message.player, message.fresh);
	if (!chat) return;
	if (!chat.gameForce) {
		// The scope query admits a legacy chat only for its original native author.
		await db
			.update(assistantChat)
			.set({ gameForce: author.force })
			.where(eq(assistantChat.id, chat.id));
		chat.gameForce = author.force;
	}
	if (sessions.get(server.id) !== session) return;
	if (serverAssistantRequests.has(chat.id)) {
		ready(chat.id);
		await steerServerTurn(
			chat.id,
			message.prompt,
			`game-steer-${server.id}-${line.id}`,
			message.player
		);
		await reply(server, message.player, 'Updated request.', chat.id);
		return;
	}
	if (serverAssistantRequests.size >= 8) {
		await reply(server, message.player, 'The assistant is busy. Try again shortly.');
		return;
	}
	const id = `game-${createHash('sha256').update(`${server.id}:${line.id}:${line.text}`).digest('hex')}`;
	const controller = serverAssistantController();
	let panelTimer: ReturnType<typeof setInterval> | undefined;
	let panelUpdating = false;
	session.controllers.add(controller);
	serverAssistantRequests.set(chat.id, controller);
	ready(chat.id);
	try {
		const inserted = await db
			.insert(serverAssistantTurn)
			.values({
				id,
				userId: ownerId,
				serverId: server.id,
				chatId: chat.id,
				gamePlayer: message.player,
				prompt: message.prompt,
				state: 'running',
				model: session.config.model,
				effort: session.config.effort,
				createdAt: new Date()
			})
			.onConflictDoNothing()
			.returning();
		const turn = inserted[0];
		if (!turn) return;
		await touchChat(chat, message.prompt);
		if (sessions.get(server.id) !== session) {
			await db
				.update(serverAssistantTurn)
				.set({ state: 'error', answer: 'Response stopped.' })
				.where(eq(serverAssistantTurn.id, id));
			return;
		}
		await syncPanel(server, session, message.player, undefined, 'Working…', chat.id).catch(
			() => {}
		);
		// The mod reads snapshots, not the model stream. Refresh only during this run.
		panelTimer = setInterval(() => {
			if (panelUpdating || controller.signal.aborted || sessions.get(server.id) !== session) return;
			panelUpdating = true;
			void syncForcePanels(server, session, message.player, chat.id)
				.catch(() => {})
				.finally(() => {
					panelUpdating = false;
				});
		}, 5000);
		panelTimer.unref();
		await finishServerTurn(
			turn,
			controller,
			() => {},
			async (progress) => {
				if (controller.signal.aborted || sessions.get(server.id) !== session) return;
				await requireGamePlayer(server, ownerId, message.player);
				if (controller.signal.aborted || sessions.get(server.id) !== session) return;
				await reply(server, message.player, progress, chat.id);
			}
		);
		// Changing settings or disconnecting never replays a response or pending game action.
		if (controller.signal.aborted || sessions.get(server.id) !== session) return;
		await requireGamePlayer(server, ownerId, message.player);
		const completed = await db
			.select()
			.from(serverAssistantTurn)
			.where(eq(serverAssistantTurn.id, id))
			.get();
		if (completed) await reply(server, message.player, completed.answer, chat.id);
	} finally {
		clearInterval(panelTimer);
		session.controllers.delete(controller);
		if (serverAssistantRequests.get(chat.id) === controller)
			serverAssistantRequests.delete(chat.id);
	}
}
function receive(server: ManagedServer, session: Session, line: LogLine) {
	const ui = parseGameUi(line.text);
	if (ui) {
		session.uiRecent = session.uiRecent.filter((time) => Date.now() - time < 60_000);
		if (session.uiRecent.length >= 60) return;
		session.uiRecent.push(Date.now());
		void receiveUi(server, session, line, ui).catch((cause) =>
			console.error(
				'Toby panel request failed:',
				cause instanceof Error ? cause.message : 'Unknown error'
			)
		);
		return;
	}

	const message = parseGameChat(line.text, session.config.chatMode === 'ambient');
	if (!message || sessions.get(server.id) !== session) return;
	if (message.ambient) {
		const now = Date.now();
		session.ambientRecent = session.ambientRecent.filter((time) => now - time < 60_000);
		if (
			session.routing.size >= 4 ||
			session.routing.has(message.player) ||
			session.ambientRecent.length >= 30
		)
			return;
		session.routing.add(message.player);
		session.ambientRecent.push(now);
		void (async () => {
			const { player: author } = await requireGamePlayer(
				server,
				session.config.ownerId,
				message.player
			);
			const chats = await db
				.select()
				.from(assistantChat)
				.where(
					and(
						eq(assistantChat.userId, session.config.ownerId),
						eq(assistantChat.serverId, server.id),
						forceChatScope(author)
					)
				)
				.orderBy(desc(assistantChat.updatedAt))
				.limit(8);
			const candidates = await Promise.all(
				chats.map(async (chat) => {
					const last = await db
						.select({ prompt: serverAssistantTurn.prompt, answer: serverAssistantTurn.answer })
						.from(serverAssistantTurn)
						.where(eq(serverAssistantTurn.chatId, chat.id))
						.orderBy(desc(serverAssistantTurn.createdAt))
						.get();
					return {
						id: chat.id,
						title: chat.title,
						prompt: (last?.prompt ?? chat.title).slice(-1500),
						answer: (last?.answer ?? '').slice(-1500),
						running: serverAssistantRequests.has(chat.id)
					};
				})
			);
			const selected = await routeAmbientChat(session.config.ownerId, message.prompt, candidates);
			if (selected === 'ignore' || sessions.get(server.id) !== session) return;
			admit(server, session, line, {
				...message,
				...(selected === 'new' ? { fresh: true } : { chatId: selected })
			});
		})()
			.catch((cause) =>
				console.error(
					'Ambient chat routing failed:',
					cause instanceof Error ? cause.message.split('\n')[0]?.slice(0, 200) : 'Unknown error'
				)
			)
			.finally(() => session.routing.delete(message.player));
		return;
	}
	admit(server, session, line, message);
}
function admit(server: ManagedServer, session: Session, line: LogLine, message: GameMessage) {
	const now = Date.now();
	session.recent = session.recent.filter((time) => now - time < 60_000);
	if (
		(!session.pending.has(message.player) && session.pending.size >= 4) ||
		session.recent.length >= 10 ||
		(!message.panel &&
			!session.pending.has(message.player) &&
			now - (session.players.get(message.player) ?? 0) < 15_000)
	)
		return;
	// Bound player cooldown state even on servers that accept many distinct names.
	for (const [player, time] of session.players)
		if (now - time >= 60_000) session.players.delete(player);
	session.players.set(message.player, now);
	session.recent.push(now);
	deliver(server, session, line, message);
}
function deliver(server: ManagedServer, session: Session, line: LogLine, message: GameMessage) {
	if (/^(?:new|new chat|start fresh)$/iu.test(message.prompt)) {
		launch(server, session, line, { ...message, fresh: true, chatId: undefined });
		return;
	}
	const pending = !message.fresh ? session.pending.get(message.player) : undefined;
	if (/^(?:stop|cancel|stop response)$/iu.test(message.prompt)) {
		void (async () => {
			const chat = message.chatId ?? (await pending?.chat);
			const controller = chat ? serverAssistantRequests.get(chat) : undefined;
			controller?.abort();
			await reply(server, message.player, controller ? 'Stopped.' : 'No response is running.');
		})().catch(() => {});
		return;
	}
	if (message.chatId) {
		if (serverAssistantRequests.has(message.chatId)) {
			void steerServerTurn(
				message.chatId,
				message.prompt,
				`game-steer-${server.id}-${line.id}`,
				message.player
			)
				.then((updated) => {
					if (updated) return reply(server, message.player, 'Updated request.', message.chatId);
					launch(server, session, line, message);
				})
				.catch(() =>
					reply(server, message.player, 'Could not update the request. Try again.').catch(() => {})
				);
		} else launch(server, session, line, message);
		return;
	}
	if (pending) {
		void (async () => {
			await requireGamePlayer(server, session.config.ownerId, message.player);
			const chat = await pending.chat;
			if (
				chat &&
				(await steerServerTurn(
					chat,
					message.prompt,
					`game-steer-${server.id}-${line.id}`,
					message.player
				))
			) {
				await reply(server, message.player, 'Updated request.');
				return;
			}
			await pending.done;
			if (sessions.get(server.id) === session) deliver(server, session, line, message);
		})().catch(async (cause: unknown) => {
			console.error(
				'In-game steering failed:',
				cause instanceof Error ? cause.message.split('\n')[0]?.slice(0, 200) : 'Unknown error'
			);
			await reply(server, message.player, 'Could not update the request. Try again.').catch(
				() => {}
			);
		});
		return;
	}
	launch(server, session, line, message);
}
function launch(server: ManagedServer, session: Session, line: LogLine, message: GameMessage) {
	const ready = Promise.withResolvers<string | null>();
	const done = Promise.withResolvers<void>();
	const pending = { chat: ready.promise, done: done.promise };
	session.pending.set(message.player, pending);
	void answer(server, session, line, message, ready.resolve)
		.catch((cause: unknown) => {
			console.error(
				'In-game assistant failed:',
				cause instanceof Error ? cause.message.split('\n')[0]?.slice(0, 200) : 'Unknown error'
			);
		})
		.finally(() => {
			ready.resolve(null);
			if (session.pending.get(message.player) === pending) session.pending.delete(message.player);
			done.resolve();
		});
}
export async function refreshInGameAssistants() {
	// A settings save must finish a scan of its own values, even during startup.
	while (scanning) await scanning.catch(() => {});
	const scan = scanServers();
	scanning = scan;
	try {
		await scan;
	} finally {
		scanning = undefined;
	}
}
async function scanServers() {
	const servers = await db.select().from(managedServer);
	const enabled = new Set<string>();
	for (const server of servers) {
		const config = await serverConfig(server)
			.then((config) => config.gameAssistant)
			.catch(() => null);
		if (!config) continue;
		if (!config.enabled || !canManageServer(config.ownerId)) continue;
		enabled.add(server.id);
		const fingerprint = JSON.stringify(config);
		const previous = sessions.get(server.id);
		if (previous?.fingerprint === fingerprint) continue;
		previous?.stop();
		for (const controller of previous?.controllers ?? []) controller.abort();
		const file = await stat(join(server.directory, 'logs/server.log')).catch(() => null);
		// Begin at the current EOF. Old chat/history is never treated as a new request,
		// including after a web-process restart or an opt-in setting change.
		const session: Session = {
			stop: () => {},
			config,
			fingerprint,
			controllers: new Set(),
			pending: new Map(),
			recent: [],
			ambientRecent: [],
			routing: new Set(),
			uiRecent: [],
			panels: new Map(),
			players: new Map()
		};
		sessions.set(server.id, session);
		session.stop = subscribeLogs(server, (packet) => {
			if (packet.type !== 'lines') return;
			for (const line of packet.lines) {
				const [inode, offset] = line.id.split(':').map(Number);
				if (file && inode === file.ino && (offset ?? 0) < file.size) continue;
				receive(server, session, line);
			}
		});
	}
	for (const [id, session] of sessions)
		if (!enabled.has(id)) {
			session.stop();
			for (const controller of session.controllers) controller.abort();
			sessions.delete(id);
		}
}
export function startInGameAssistants() {
	if (timer) return;
	timer = setInterval(
		() =>
			void refreshInGameAssistants().catch((cause: unknown) =>
				console.error('In-game assistant startup failed:', cause)
			),
		10_000
	);
	timer.unref();
	void refreshInGameAssistants().catch((cause: unknown) =>
		console.error('In-game assistant startup failed:', cause)
	);
}
function close() {
	if (timer) clearInterval(timer);
	timer = undefined;
	for (const session of sessions.values()) {
		session.stop();
		for (const controller of session.controllers) controller.abort();
	}
	sessions.clear();
}
process.once('sveltekit:shutdown', close);
if (import.meta.hot) import.meta.hot.dispose(close);
