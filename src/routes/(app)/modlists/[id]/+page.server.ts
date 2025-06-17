import { db } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
	const result = await db
		.select()
		.from(table.modList)
		.rightJoin(table.mod, eq(table.modList.id, table.mod.modlist))
		.where(eq(table.modList.id, event.params.id));
	if (result.length === 0) {
		return error(404, { message: 'modlist not found' });
	}
	return {
		modlist: result[0].modlist,
		mods: result.map((r) => r.mod)
	};
};

export const actions: Actions = {
	toggleStatus: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}
		const formData = await event.request.formData();
		const modID = formData.get('modid')?.toString();
		if (!modID) {
			return fail(400);
		}
		const mod = await db.select().from(table.mod).where(eq(table.mod.id, modID)).get();
		if (!mod) {
			return fail(404);
		}
		await db.update(table.mod).set({ enabled: !mod.enabled }).where(eq(table.mod.id, modID));
		return redirect(303, `/modlists/${event.params.id}`);
	}
};
