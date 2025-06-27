import { eq, or, inArray } from 'drizzle-orm';
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

	// Batch fetch collaborators and mod counts to avoid N+1 queries
	const modlistIds = baseModLists.map((ml) => ml.id);

	// Batch fetch all collaborators for all modlists
	const allCollaborators =
		modlistIds.length > 0
			? await db
					.select({
						modlistId: table.modListCollaborator.modlistId,
						id: table.user.id,
						username: table.user.username
					})
					.from(table.modListCollaborator)
					.innerJoin(table.user, eq(table.user.id, table.modListCollaborator.userId))
					.where(inArray(table.modListCollaborator.modlistId, modlistIds))
			: [];

	// Group collaborators by modlist ID
	const collaboratorsByModlist = new Map<string, Array<{ id: string; username: string }>>();
	for (const collab of allCollaborators) {
		if (!collaboratorsByModlist.has(collab.modlistId)) {
			collaboratorsByModlist.set(collab.modlistId, []);
		}
		collaboratorsByModlist.get(collab.modlistId)!.push({
			id: collab.id,
			username: collab.username
		});
	}

	// Batch fetch all mod counts for all modlists
	const allMods =
		modlistIds.length > 0
			? await db
					.select({
						modlistId: table.mod.modlist,
						enabled: table.mod.enabled
					})
					.from(table.mod)
					.where(inArray(table.mod.modlist, modlistIds))
			: [];

	// Group and count mods by modlist ID
	const modCountsByModlist = new Map<string, { total: number; enabled: number }>();
	for (const mod of allMods) {
		if (!modCountsByModlist.has(mod.modlistId)) {
			modCountsByModlist.set(mod.modlistId, { total: 0, enabled: 0 });
		}
		const counts = modCountsByModlist.get(mod.modlistId)!;
		counts.total++;
		if (mod.enabled) counts.enabled++;
	}

	// Build full details for each modlist using the batched data
	const modLists = baseModLists.map((ml) => ({
		...ml,
		collaborators: collaboratorsByModlist.get(ml.id) || [],
		totalMods: modCountsByModlist.get(ml.id)?.total || 0,
		enabledCount: modCountsByModlist.get(ml.id)?.enabled || 0
	}));

	return { user: event.locals.user, modLists };
};
