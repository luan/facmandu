import type { RequestHandler } from '@sveltejs/kit';
import { factorioApiLimiter } from '$lib/server/rate-limiter';

export const GET: RequestHandler = async ({ params }) => {
	const { name } = params;
	if (!name) {
		return new Response(JSON.stringify({ error: 'Mod name is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Validate mod name format to prevent SSRF attacks
	if (!/^[a-zA-Z0-9_-]+$/.test(name) || name.length > 100) {
		return new Response(JSON.stringify({ error: 'Invalid mod name format' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const upstream = await factorioApiLimiter.fetch(
			`https://mods.factorio.com/api/mods/${name}/full`,
			{
				signal: AbortSignal.timeout(30000), // 30 second timeout
				headers: {
					'User-Agent': 'FactorioManager/1.0'
				}
			}
		);
		const body = await upstream.text();

		// Only forward successful responses and specific error codes
		if (upstream.status === 200 || upstream.status === 404) {
			return new Response(body, {
				status: upstream.status,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=1800, s-maxage=3600' // 30 min browser, 1 hour CDN
				}
			});
		} else {
			return new Response(JSON.stringify({ error: 'Mod not found or unavailable' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	} catch {
		return new Response(JSON.stringify({ error: 'Failed to fetch mod information' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
