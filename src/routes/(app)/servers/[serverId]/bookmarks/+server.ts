import { createHash } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { cachedPortalRequest } from '$lib/server/portal-cache';
import { serverConfig } from '$lib/server/server-files';
import { serverModInventory } from '$lib/server/server-mods';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	try {
		const [inventory, config] = await Promise.all([
			serverModInventory(server),
			serverConfig(server)
		]);
		const account = config.account;
		if (!account.username || !account.token)
			return json({
				...inventory,
				names: [],
				warning: 'Connect a Factorio account in this server’s Settings to see bookmarks.'
			});
		const key = createHash('sha256').update(JSON.stringify(account)).digest('hex');
		const query = new URLSearchParams(account);
		const result = await cachedPortalRequest(
			`bookmarks:${key}`,
			`https://mods.factorio.com/api/bookmarks?${query}`,
			z.array(z.string()),
			{ maxAgeMs: 15 * 60_000 }
		);
		return json(
			{ ...inventory, names: [...new Set(result.data ?? [])].sort(), warning: result.warning },
			{
				headers: { 'Cache-Control': 'private, no-store' }
			}
		);
	} catch {
		error(502, 'Could not load bookmarks. Check the server’s Factorio account and try again.');
	}
};
