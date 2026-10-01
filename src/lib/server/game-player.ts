import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import { type GameAssistantConfig, ServerError, serverConfig } from './server-files';
import { rconScript } from './server-rcon';

export const gamePlayerSchema = z.object({
	name: z.string(),
	force: z.string(),
	surface: z.string(),
	position: z.object({ x: z.number(), y: z.number() }),
	admin: z.boolean(),
	connected: z.literal(true)
});
export type GamePlayer = z.infer<typeof gamePlayerSchema>;
export function assertGameAction(
	config: GameAssistantConfig,
	ownerId: string,
	player: GamePlayer,
	force: unknown
) {
	if (!config.enabled || config.ownerId !== ownerId)
		throw new ServerError(403, 'In-game assistant is disabled');
	if (force !== player.force) throw new ServerError(403, 'You can only change your own force');
	if (
		!(config.actions === 'admins' && player.admin) &&
		!(config.actions === 'allowlist' && config.players.includes(player.name))
	)
		throw new ServerError(403, 'Factory actions are not enabled for this player');
}
export async function requireGamePlayer(server: ManagedServer, ownerId: string, name: string) {
	const config = (await serverConfig(server)).gameAssistant;
	if (!config.enabled || config.ownerId !== ownerId)
		throw new ServerError(403, 'In-game assistant is disabled');
	if (!/^[A-Za-z0-9_-]{3,30}$/u.test(name)) throw new ServerError(400, 'Invalid player');
	const output = await rconScript(
		server,
		`/silent-command local p=game.get_player(${JSON.stringify(name)}); if p and p.connected then rcon.print(helpers.table_to_json({name=p.name,force=p.force.name,surface=p.surface.name,position=p.position,admin=p.admin,connected=p.connected})) else rcon.print("null") end`
	);
	const parsed = gamePlayerSchema.safeParse(JSON.parse(output));
	if (!parsed.success) throw new ServerError(403, 'Player is not connected');
	return { config, player: parsed.data };
}
