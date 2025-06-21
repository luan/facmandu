import { eq, or } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import type { LayoutServerLoad } from './$types';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { genID } from '$lib/server/db/ids';

export const load: LayoutServerLoad = async () => {
	const user = requireLogin();

	const modListRows = await db
		.select()
		.from(table.modList)
		.leftJoin(table.modListCollaborator, eq(table.modListCollaborator.modlistId, table.modList.id))
		.where(or(eq(table.modList.owner, user.id), eq(table.modListCollaborator.userId, user.id)));

	// Extract unique modlist objects
	const modListMap = new Map<string, typeof table.modList.$inferSelect>();
	for (const row of modListRows) {
		// When using joins, Drizzle returns an object with keys matching table names
		const ml = (row as any).modlist ?? (row as any); // fallback if structure different
		if (ml && !modListMap.has(ml.id)) {
			modListMap.set(ml.id, ml);
		}
	}

	return { user, modLists: Array.from(modListMap.values()) };
};

function requireLogin() {
	const { locals, url } = getRequestEvent();

	if (!locals.user) {
		return redirect(303, `/login?redirectTo=${url.pathname}`);
	}

	return locals.user;
}
