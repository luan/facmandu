import { eq } from 'drizzle-orm';
import { fail, type Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { genID } from '$lib/server/db/ids';

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
