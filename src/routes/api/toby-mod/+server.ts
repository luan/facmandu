import { error } from '@sveltejs/kit';
import { tobyModArchive, tobyModInfo } from '$lib/server/toby-mod';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	const folder = `${tobyModInfo.name}_${tobyModInfo.version}`;
	return new Response(new Uint8Array(tobyModArchive()), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${folder}.zip"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
