import { error } from '@sveltejs/kit';
import { worldGenerationSchema } from '$lib/map-generation';
import { mapGenerationPreview } from '$lib/server/map-generation-native';
import { ServerError } from '$lib/server/server-files';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Sign in');
	const server = await requireServer(locals.user.id, params.serverId);
	if (Number(request.headers.get('content-length') ?? 0) > 16_384) error(413, 'Map settings are too large');
	let body: unknown;
	try {
		const reader = request.body?.getReader();
		if (!reader) error(400, 'Missing map settings');
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 16_384) error(413, 'Map settings are too large');
			chunks.push(value);
		}
		body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(400, 'Invalid JSON');
	}
	const parsed = worldGenerationSchema.safeParse((body as { settings?: unknown })?.settings);
	if (!parsed.success) error(400, 'Invalid map settings');
	try {
		const png = await mapGenerationPreview(server, parsed.data);
		return new Response(new Uint8Array(png), { headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'private, no-cache',
			'X-Content-Type-Options': 'nosniff'
		} });
	} catch (cause) {
		if (cause instanceof ServerError) error(cause.status, cause.message);
		throw cause;
	}
};
