import { fail, type RequestEvent } from '@sveltejs/kit';
import { userHasModlistAccess } from '$lib/server/db';

/**
 * Ensures a request comes from an authenticated user that has access to the given modlist.
 * If the user is not authenticated, returns a 401 response. If they don't have access,
 * returns a 403 response. Otherwise returns the user ID for further use.
 */
export async function ensureModlistAccess(event: RequestEvent, modlistId: string): Promise<string> {
	if (!event.locals.session) {
		throw fail(401);
	}

	const { userId } = event.locals.session;

	const allowed = await userHasModlistAccess(userId, modlistId);
	if (!allowed) {
		throw fail(403);
	}

	return userId;
}
