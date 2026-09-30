import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireSameOrigin } from '$lib/server/auth';
import { removeFactoryWatch, setFactoryWatchEnabled } from '$lib/server/factory-watches';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request, url }) => {
	requireSameOrigin(request, url);
	if (!locals.user) error(401, 'Sign in');
	const input = z
		.object({ enabled: z.boolean() })
		.safeParse(await request.json().catch(() => null));
	if (!input.success) error(400, 'Invalid watch state');
	return json(
		await setFactoryWatchEnabled(
			locals.user.id,
			params.serverId,
			params.watchId,
			input.data.enabled
		)
	);
};

export const DELETE: RequestHandler = async ({ locals, params, request, url }) => {
	requireSameOrigin(request, url);
	if (!locals.user) error(401, 'Sign in');
	return json(await removeFactoryWatch(locals.user.id, params.serverId, params.watchId));
};
