import { eq, or } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import type { LayoutServerLoad } from './$types';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';

export const load: LayoutServerLoad = async () => {
	const { cookies, locals, url } = getRequestEvent();

	// If user is logged in, behave as before
	if (locals.user) {
		const user = locals.user;

		const modListRows = await db
			.select()
			.from(table.modList)
			.leftJoin(
				table.modListCollaborator,
				eq(table.modListCollaborator.modlistId, table.modList.id)
			)
			.where(or(eq(table.modList.owner, user.id), eq(table.modListCollaborator.userId, user.id)));

		const modListMap = new Map<string, typeof table.modList.$inferSelect>();
		for (const row of modListRows) {
			const mlCandidate = (row as unknown as { modlist?: typeof table.modList.$inferSelect })
				.modlist;
			const ml = mlCandidate ?? (row as unknown as typeof table.modList.$inferSelect);
			if (ml && !modListMap.has(ml.id)) {
				modListMap.set(ml.id, ml);
			}
		}

		const sidebarCookie = cookies.get(SIDEBAR_COOKIE_NAME);
		const sidebarOpen = sidebarCookie === undefined ? true : sidebarCookie === 'true';

		return { user, modLists: Array.from(modListMap.values()), sidebarOpen };
	}

	// User not logged in – allow access only if visiting a public modlist
	const pathname = url.pathname;
	const match = pathname.match(/^\/modlists\/([^/]+)/);

	if (match) {
		const modlistId = match[1];
		const publicRow = await db
			.select({ publicRead: table.modList.publicRead })
			.from(table.modList)
			.where(eq(table.modList.id, modlistId))
			.get();

		if (publicRow?.publicRead) {
			const sidebarCookie = cookies.get(SIDEBAR_COOKIE_NAME);
			const sidebarOpen = sidebarCookie === undefined ? true : sidebarCookie === 'true';
			return { user: null, modLists: [], sidebarOpen };
		}
	}

	// Otherwise redirect to login
	return redirect(303, `/login?redirectTo=${pathname}`);
};
