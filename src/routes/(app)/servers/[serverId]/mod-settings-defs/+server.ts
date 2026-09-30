import { error, json } from '@sveltejs/kit';
import { modSettingDef, modSettingsCatalog } from '$lib/server/mod-settings-defs';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	const name = url.searchParams.get('mod')?.trim();
	try {
		if (name === undefined)
			return json(await modSettingsCatalog(server), {
				headers: { 'Cache-Control': 'no-store' }
			});
		if (!name) error(400, 'Choose a mod first');
		const parsed = await modSettingDef(server, name);
		if (!parsed) error(404, 'No settings known for this mod');
		return json(parsed, { headers: { 'Cache-Control': 'no-store' } });
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(502, 'Could not read mod settings. Try again.');
	}
};
