import { fail, type RequestEvent } from '@sveltejs/kit';
import { userHasModlistAccess } from '$lib/server/db';

type AccessResult =
	| { success: true; userId: string }
	| { success: false; error: ReturnType<typeof fail> };

/**
 * Ensures a request comes from an authenticated user that has access to the given modlist.
 * Returns either success with userId or failure with appropriate error response.
 */
export async function ensureModlistAccess(
	event: RequestEvent,
	modlistId: string
): Promise<AccessResult> {
	if (!event.locals.session) {
		return { success: false, error: fail(401) };
	}

	const { userId } = event.locals.session;

	const allowed = await userHasModlistAccess(userId, modlistId);
	if (!allowed) {
		return { success: false, error: fail(403) };
	}

	return { success: true, userId };
}
