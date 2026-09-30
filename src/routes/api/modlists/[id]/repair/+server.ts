import { json } from '@sveltejs/kit';
import { userHasModlistAccess } from '$lib/server/db';
import { repairProgress, startModlistRepair } from '$lib/server/modlist-repair';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.session || !(await userHasModlistAccess(locals.session.userId, params.id))) {
		return new Response('Forbidden', { status: 403 });
	}
	return json(repairProgress(params.id));
};

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.session || !(await userHasModlistAccess(locals.session.userId, params.id))) {
		return new Response('Forbidden', { status: 403 });
	}
	return json(startModlistRepair(params.id, locals.session.userId));
};
