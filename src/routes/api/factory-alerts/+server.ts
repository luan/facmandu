import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireSameOrigin } from '$lib/server/auth';
import { listFactoryAlerts, readFactoryAlert } from '$lib/server/factory-watches';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Sign in');
	return json(await listFactoryAlerts(locals.user.id), {
		headers: { 'Cache-Control': 'no-store' }
	});
};

export const PATCH: RequestHandler = async ({ locals, request, url }) => {
	requireSameOrigin(request, url);
	if (!locals.user) error(401, 'Sign in');
	const input = z
		.object({ id: z.string().min(1).max(100) })
		.safeParse(await request.json().catch(() => null));
	if (!input.success) error(400, 'Invalid alert');
	return json(await readFactoryAlert(locals.user.id, input.data.id));
};
