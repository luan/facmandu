import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { factoryLayoutInput } from '$lib/factory-layout';
import { parseGameLayout } from '$lib/game-chat';
import { db } from './db';
import { type ManagedServer, managedServer } from './db/schema';
import { designFactory } from './factory-layout';
import { layoutFailureMessage } from './factory-layout-saved-plan';
import { luaString } from './factory-query-bundle';
import { subscribeLogs } from './server-logs';
import { rconScript } from './server-rcon';

async function nativeCall(
	server: ManagedServer,
	method: 'read_request' | 'complete',
	args: unknown[]
) {
	const output = await rconScript(
		server,
		`/silent-command local args=helpers.json_to_table(${luaString(JSON.stringify(args))}); local ok,value=pcall(function() if not remote.interfaces['facmandu-toby-layout'] then return nil end; return remote.call('facmandu-toby-layout',${luaString(method)},table.unpack(args)) end); rcon.print(helpers.table_to_json(ok and {ok=true,value=value} or {ok=false,error=tostring(value)}))`
	);
	const reply = z
		.discriminatedUnion('ok', [
			z.object({ ok: z.literal(true), value: z.json().optional() }),
			z.object({ ok: z.literal(false), error: z.string() })
		])
		.parse(JSON.parse(output.trim()));
	if (!reply.ok) throw new Error(reply.error);
	return reply.value;
}
// Native pending requests are authoritative. Log text alone cannot select a force,
// change a plan, authorize placement, or spend model credits.
export async function receiveLayout(
	server: ManagedServer,
	message: NonNullable<ReturnType<typeof parseGameLayout>>
) {
	const args = [message.player, message.id, message.planId];
	try {
		const pending = await nativeCall(server, 'read_request', args);
		if (!pending) return;
		// Remove 0.0.19's manual vectors until all servers have the automatic-geometry UI.
		const { inserters: _legacyVectors, ...selection } = z
			.record(z.string(), z.json())
			.parse(pending);
		const request = factoryLayoutInput.parse(selection);
		if (request.player !== message.player) throw new Error('Layout player changed');
		const result = await designFactory(server, request, {
			name: message.player,
			requireAdmin: false
		});
		const artifact = z
			.object({ blueprint: z.string(), designId: z.string() })
			.parse(result.artifact);
		await nativeCall(server, 'complete', [...args, artifact]);
	} catch (cause) {
		const error = layoutFailureMessage(cause);
		await nativeCall(server, 'complete', [...args, { error }]).catch(() => {});
		console.error('In-game layout failed:', error);
	}
}
const sessions = new Map<string, { stop: () => void; busy: boolean }>();
let timer: ReturnType<typeof setInterval> | undefined;
let scanning = false;
async function scan() {
	if (scanning) return;
	scanning = true;
	try {
		const servers = await db.select().from(managedServer);
		const ids = new Set(servers.map((server) => server.id));
		for (const server of servers) {
			if (sessions.has(server.id)) continue;
			const file = await stat(join(server.directory, 'logs/server.log')).catch(() => null);
			const session = { stop: () => {}, busy: false };
			sessions.set(server.id, session);
			session.stop = subscribeLogs(server, (packet) => {
				if (packet.type !== 'lines') return;
				for (const line of packet.lines) {
					const [inode, offset] = line.id.split(':').map(Number);
					if (file && inode === file.ino && (offset ?? 0) < file.size) continue;
					const message = parseGameLayout(line.text);
					// Other requests retry from native state; no unbounded search queue.
					if (!message || session.busy) continue;
					session.busy = true;
					void receiveLayout(server, message).finally(() => {
						session.busy = false;
					});
				}
			});
		}
		for (const [id, session] of sessions)
			if (!ids.has(id)) {
				session.stop();
				sessions.delete(id);
			}
	} finally {
		scanning = false;
	}
}
export function startInGameLayouts() {
	if (timer) return;
	timer = setInterval(() => void scan().catch(console.error), 10_000);
	timer.unref();
	void scan().catch(console.error);
}
function close() {
	if (timer) clearInterval(timer);
	timer = undefined;
	for (const session of sessions.values()) session.stop();
	sessions.clear();
}
process.once('sveltekit:shutdown', close);
if (import.meta.hot) import.meta.hot.dispose(close);
