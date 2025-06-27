import { eq, or } from 'drizzle-orm';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { genID } from '$lib/server/db/ids';
import type { PageServerLoad } from './$types';
// import { error } from '@sveltejs/kit';

export const actions: Actions = {
	duplicate: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const formData = await event.request.formData();
		const modlistId = formData.get('modlistId')?.toString();

		if (!modlistId) {
			return fail(400, { message: 'Modlist ID is required' });
		}

		try {
			// Get the original modlist and verify ownership
			const originalModlist = await db
				.select()
				.from(table.modList)
				.where(eq(table.modList.id, modlistId))
				.get();

			if (!originalModlist || originalModlist.owner !== event.locals.user!.id) {
				return fail(404, { message: 'Modlist not found or access denied' });
			}

			// Get all mods from the original modlist
			const originalMods = await db
				.select()
				.from(table.mod)
				.where(eq(table.mod.modlist, modlistId));

			// Create duplicate with transaction
			await db.transaction(async (tx) => {
				// Create new modlist
				const newModlistId = genID('modlist');
				await tx.insert(table.modList).values({
					id: newModlistId,
					name: `${originalModlist.name} (Copy)`,
					owner: event.locals.user!.id
				});

				// Duplicate all mods if there are any
				if (originalMods.length > 0) {
					await tx.insert(table.mod).values(
						originalMods.map((mod) => ({
							id: genID('mod'),
							modlist: newModlistId,
							name: mod.name,
							enabled: mod.enabled,
							title: mod.title,
							summary: mod.summary,
							description: mod.description,
							category: mod.category,
							tags: mod.tags,
							thumbnail: mod.thumbnail,
							downloadsCount: mod.downloadsCount,
							lastUpdated: mod.lastUpdated,
							version: mod.version,
							factorioVersion: mod.factorioVersion,
							dependencies: mod.dependencies,
							lastFetched: mod.lastFetched,
							fetchError: mod.fetchError
						}))
					);
				}
			});

			return { success: true, message: 'Modlist duplicated successfully' };
		} catch (error) {
			console.error('Duplicate modlist error:', error);
			return fail(500, { message: 'Failed to duplicate modlist' });
		}
	}
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(303, `/login?redirectTo=/`);
	}

	// Retrieve all modlists the user owns or collaborates on
	const modListRows = await db
		.select()
		.from(table.modList)
		.leftJoin(table.modListCollaborator, eq(table.modListCollaborator.modlistId, table.modList.id))
		.where(
			or(
				eq(table.modList.owner, event.locals.user.id),
				eq(table.modListCollaborator.userId, event.locals.user.id)
			)
		);

	// Deduplicate results coming from the join
	const modListMap = new Map<string, typeof table.modList.$inferSelect>();
	for (const row of modListRows) {
		// Drizzle returns joined rows as objects keyed by table name
		const mlCandidate = (row as unknown as { modlist?: typeof table.modList.$inferSelect }).modlist;
		const ml = mlCandidate ?? (row as unknown as typeof table.modList.$inferSelect);
		if (ml) {
			modListMap.set(ml.id, ml);
		}
	}

	const baseModLists = Array.from(modListMap.values());

	// Build full details for each modlist (collaborators and enabled/total mod counts)
	const modLists = await Promise.all(
		baseModLists.map(async (ml) => {
			// Fetch collaborators (usernames only)
			const collaborators = await db
				.select({ id: table.user.id, username: table.user.username })
				.from(table.modListCollaborator)
				.innerJoin(table.user, eq(table.user.id, table.modListCollaborator.userId))
				.where(eq(table.modListCollaborator.modlistId, ml.id));

			// Fetch mod enable/total counts
			const mods = await db
				.select({ enabled: table.mod.enabled })
				.from(table.mod)
				.where(eq(table.mod.modlist, ml.id));

			const totalMods = mods.length;
			const enabledCount = mods.filter((m) => m.enabled).length;

			return {
				...ml,
				collaborators,
				totalMods,
				enabledCount
			};
		})
	);

	return { user: event.locals.user, modLists };
};
