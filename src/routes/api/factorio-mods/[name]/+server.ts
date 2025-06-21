import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ params, fetch }) => {
	const { name } = params;
	if (!name) {
		return new Response(JSON.stringify({ error: 'Mod name is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const upstream = await fetch(`https://mods.factorio.com/api/mods/${name}/full`);
	const body = await upstream.text();

	return new Response(body, {
		status: upstream.status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=60'
		}
	});
};
