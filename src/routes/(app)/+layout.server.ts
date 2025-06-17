import { eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import type { LayoutServerLoad } from './$types';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';

export const load: LayoutServerLoad = async () => {
	const user = requireLogin();
	const modLists = await db.select().from(table.modList).where(eq(table.modList.owner, user.id));
	return { user, modLists };
};

function requireLogin() {
	const { locals, url } = getRequestEvent();

	if (!locals.user) {
		return redirect(303, `/login?redirectTo=${url.pathname}`);
	}

	return locals.user;
}
