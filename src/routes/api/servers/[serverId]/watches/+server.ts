import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireSameOrigin } from '$lib/server/auth';
import {
	createFactoryWatch,
	factoryWatchInput,
	listFactoryWatches
} from '$lib/server/factory-watches';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in');
	return json(await listFactoryWatches(locals.user.id, params.serverId), {
		headers: { 'Cache-Control': 'no-store' }
	});
};

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	requireSameOrigin(request, url);
	if (!locals.user) error(401, 'Sign in');
	const input = factoryWatchInput.safeParse(await request.json().catch(() => null));
	if (!input.success) error(400, z.prettifyError(input.error));
	return json(await createFactoryWatch(locals.user.id, params.serverId, input.data), {
		status: 201
	});
};
