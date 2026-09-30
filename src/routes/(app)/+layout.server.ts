import { redirect } from '@sveltejs/kit';
import { eq, getTableColumns, or } from 'drizzle-orm';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { canManageServer, listServers } from '$lib/server/servers';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, locals, url, depends }) => {
	depends('app:library');

	// If user is logged in, behave as before
	if (locals.user) {
		const user = locals.user;

		const [modLists, servers] = await Promise.all([
			db
				.selectDistinct(getTableColumns(table.modList))
				.from(table.modList)
				.leftJoin(
					table.modListCollaborator,
					eq(table.modListCollaborator.modlistId, table.modList.id)
				)
				.where(or(eq(table.modList.owner, user.id), eq(table.modListCollaborator.userId, user.id))),
			listServers(user.id)
		]);

		const sidebarCookie = cookies.get(SIDEBAR_COOKIE_NAME);
		const sidebarOpen = sidebarCookie === undefined ? true : sidebarCookie === 'true';

		return {
			user,
			modLists,
			sidebarOpen,
			canManageServer: canManageServer(user.id),
			servers
		};
	}

	// User not logged in – allow access only if visiting a public modlist
	const pathname = url.pathname;
	const match = pathname.match(/^\/modlists\/([^/]+)/);

	const modlistId = match?.[1];
	if (modlistId) {
		const publicRow = await db
			.select({ publicRead: table.modList.publicRead })
			.from(table.modList)
			.where(eq(table.modList.id, modlistId))
			.get();

		if (publicRow?.publicRead) {
			const sidebarCookie = cookies.get(SIDEBAR_COOKIE_NAME);
			const sidebarOpen = sidebarCookie === undefined ? true : sidebarCookie === 'true';
			return { user: null, modLists: [], sidebarOpen, canManageServer: false, servers: [] };
		}
	}

	// Otherwise redirect to login
	return redirect(303, `/login?redirectTo=${encodeURIComponent(pathname + url.search)}`);
};
