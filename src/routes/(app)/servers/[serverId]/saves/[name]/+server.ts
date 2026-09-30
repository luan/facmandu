import { Readable } from 'node:stream';
import { readSave, serverSaves } from '$lib/server/server-saves';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, locals }) => {
	const server = await requireServer(locals.user?.id, params.serverId);
	const save = (await serverSaves(server)).find((save) => save.name === params.name);
	if (!save) return new Response('Save not found', { status: 404 });
	return new Response(Readable.toWeb(readSave(server, save.name)) as ReadableStream<Uint8Array>, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Length': String(save.size),
			'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(save.name)}`,
			'Cache-Control': 'no-store'
		}
	});
};
