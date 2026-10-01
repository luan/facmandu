import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { gameReply, parseGameChat } from '$lib/game-chat';
import { db } from './db';
import { genID } from './db/ids';
import { assistantChat, type ManagedServer, managedServer, serverAssistantTurn } from './db/schema';
import { requireGamePlayer } from './game-player';
import { finishServerTurn, serverAssistantRequests } from './server-assistant';
import { type GameAssistantConfig, serverConfig } from './server-files';
import { type LogLine, subscribeLogs } from './server-logs';
import { rconScript } from './server-rcon';
import { canManageServer } from './servers';

type Session = {
	stop: () => void;
	controllers: Set<AbortController>;
	config: GameAssistantConfig;
	fingerprint: string;
	pending: Set<string>;
	recent: number[];
	players: Map<string, number>;
};
const sessions = new Map<string, Session>();
let timer: ReturnType<typeof setInterval> | undefined;
let scanning: Promise<void> | undefined;

async function reply(server: ManagedServer, player: string, answer: string) {
	for (const text of gameReply(answer))
		await rconScript(
			server,
			`/silent-command local p=game.get_player(${JSON.stringify(player)}); if p and p.connected then p.print(${JSON.stringify(`Assistant: ${text}`)}) end`
		);
}
async function chatFor(server: ManagedServer, ownerId: string, player: string, fresh = false) {
	const existing = !fresh
		? await db
				.select()
				.from(assistantChat)
				.where(
					and(
						eq(assistantChat.userId, ownerId),
						eq(assistantChat.serverId, server.id),
						eq(assistantChat.gamePlayer, player)
					)
				)
				.orderBy(desc(assistantChat.updatedAt), desc(assistantChat.id))
				.get()
		: null;
	if (existing) return existing;
	const chat = {
		id: genID('chat'),
		userId: ownerId,
		serverId: server.id,
		gamePlayer: player,
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
	message: { player: string; prompt: string }
) {
	const ownerId = session.config.ownerId;
	await requireGamePlayer(server, ownerId, message.player);
	if (sessions.get(server.id) !== session) return;
	if (/^(?:new|new chat|start fresh)$/iu.test(message.prompt)) {
		await chatFor(server, ownerId, message.player, true);
		await reply(server, message.player, 'Started a new chat.');
		return;
	}
	const chat = await chatFor(server, ownerId, message.player);
	if (sessions.get(server.id) !== session) return;
	if (serverAssistantRequests.has(chat.id) || serverAssistantRequests.size >= 8) {
		await reply(server, message.player, 'The assistant is busy. Try again shortly.');
		return;
	}
	const id = `game-${createHash('sha256').update(`${server.id}:${line.id}:${line.text}`).digest('hex')}`;
	const controller = new AbortController();
	session.controllers.add(controller);
	serverAssistantRequests.set(chat.id, controller);
	try {
		const inserted = await db
			.insert(serverAssistantTurn)
			.values({
				id,
				userId: ownerId,
				serverId: server.id,
				chatId: chat.id,
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
		await db
			.update(assistantChat)
			.set({ updatedAt: new Date() })
			.where(eq(assistantChat.id, chat.id));
		if (sessions.get(server.id) !== session) {
			await db
				.update(serverAssistantTurn)
				.set({ state: 'error', answer: 'Response stopped.' })
				.where(eq(serverAssistantTurn.id, id));
			return;
		}
		await finishServerTurn(turn, controller, () => {});
		// Changing settings or disconnecting never replays a response or pending game action.
		if (controller.signal.aborted || sessions.get(server.id) !== session) return;
		await requireGamePlayer(server, ownerId, message.player);
		const completed = await db
			.select()
			.from(serverAssistantTurn)
			.where(eq(serverAssistantTurn.id, id))
			.get();
		if (completed) await reply(server, message.player, completed.answer);
	} finally {
		session.controllers.delete(controller);
		if (serverAssistantRequests.get(chat.id) === controller)
			serverAssistantRequests.delete(chat.id);
	}
}
function receive(server: ManagedServer, session: Session, line: LogLine) {
	const message = parseGameChat(line.text);
	if (!message || sessions.get(server.id) !== session) return;
	const now = Date.now();
	session.recent = session.recent.filter((time) => now - time < 60_000);
	if (
		session.pending.has(message.player) ||
		session.pending.size >= 4 ||
		session.recent.length >= 10 ||
		now - (session.players.get(message.player) ?? 0) < 15_000
	)
		return;
	// Bound player cooldown state even on servers that accept many distinct names.
	for (const [player, time] of session.players)
		if (now - time >= 60_000) session.players.delete(player);
	session.players.set(message.player, now);
	session.recent.push(now);
	session.pending.add(message.player);
	void answer(server, session, line, message)
		.catch((cause: unknown) => {
			console.error(
				'In-game assistant failed:',
				cause instanceof Error ? cause.message.split('\n')[0]?.slice(0, 200) : 'Unknown error'
			);
		})
		.finally(() => session.pending.delete(message.player));
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
			pending: new Set(),
			recent: [],
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
