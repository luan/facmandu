import { fail, redirect } from '@sveltejs/kit';
import { count, eq, inArray, sql } from 'drizzle-orm';
import { db, userHasModlistAccess } from '$lib/server/db';
import { genID } from '$lib/server/db/ids';
import * as table from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const actions: Actions = {
	duplicate: async ({ locals, request }) => {
		const user = locals.user;
		if (!user) return fail(401, { message: 'Unauthorized' });
		const fields = await request.formData();
		const source = fields.get('modlistId');
		if (typeof source !== 'string' || !(await userHasModlistAccess(user.id, source)))
			return fail(404, { message: 'Mod list not found' });
		const id = genID('modlist');
		try {
			await db.transaction(async (tx) => {
				const list = await tx
					.select()
					.from(table.modList)
					.where(eq(table.modList.id, source))
					.get();
				if (!list) throw new Error('Mod list no longer exists');
				const mods = await tx.select().from(table.mod).where(eq(table.mod.modlist, source));
				await tx.insert(table.modList).values({
					id,
					name: `${list.name.slice(0, 93)} (Copy)`,
					owner: user.id,
					factorioVersion: list.factorioVersion
				});
				// Bound each statement below SQLite's parameter limit, even for very large lists.
				for (let offset = 0; offset < mods.length; offset += 20)
					await tx
						.insert(table.mod)
						.values(
							mods
								.slice(offset, offset + 20)
								.map((mod) => ({ ...mod, id: genID('mod'), modlist: id }))
						);
			});
		} catch (cause) {
			console.error('Could not duplicate mod list:', cause);
			return fail(500, { message: 'Could not duplicate the list. Try again.' });
		}
		redirect(303, `/modlists/${id}`);
	}
};

export const load: PageServerLoad = async ({ parent }) => {
	const layout = await parent();
	const ids = layout.modLists.map((list) => list.id);
	if (!ids.length) return { modLists: [] };
	const [collaborators, counts] = await Promise.all([
		db
			.select({
				modlistId: table.modListCollaborator.modlistId,
				id: table.user.id,
				username: table.user.username
			})
			.from(table.modListCollaborator)
			.innerJoin(table.user, eq(table.user.id, table.modListCollaborator.userId))
			.where(inArray(table.modListCollaborator.modlistId, ids)),
		db
			.select({
				modlistId: table.mod.modlist,
				total: count(),
				enabled: sql<number>`sum(case when ${table.mod.enabled} = 1 and coalesce(${table.mod.icebox}, 0) = 0 then 1 else 0 end)`
			})
			.from(table.mod)
			.where(inArray(table.mod.modlist, ids))
			.groupBy(table.mod.modlist)
	]);
	const countByList = new Map(counts.map((item) => [item.modlistId, item]));
	return {
		modLists: layout.modLists.map((list) => ({
			...list,
			collaborators: collaborators.filter((item) => item.modlistId === list.id),
			totalMods: countByList.get(list.id)?.total ?? 0,
			enabledCount: countByList.get(list.id)?.enabled ?? 0
		}))
	};
};
