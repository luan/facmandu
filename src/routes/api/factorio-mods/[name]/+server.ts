import { json, type RequestHandler } from '@sveltejs/kit';
import { validModName } from '$lib/server/mod-names';
import { getPortalMod } from '$lib/server/portal-cache';

export const GET: RequestHandler = async ({ params }) => {
	const { name } = params;
	if (!name || !validModName(name)) return json({ error: 'Invalid mod name' }, { status: 400 });
	try {
		const result = await getPortalMod(name, true);
		if (result.warning)
			return json({ error: 'Current mod metadata could not be verified' }, { status: 503 });
		return result.data
			? json(result.data, {
					headers: { 'Cache-Control': 'public, no-cache', 'X-Metadata-Cache': result.source }
				})
			: json({ error: 'Mod not found' }, { status: 404 });
	} catch {
		return json({ error: 'Mod portal temporarily unavailable' }, { status: 503 });
	}
};
