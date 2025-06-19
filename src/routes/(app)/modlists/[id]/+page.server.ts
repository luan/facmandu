import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.session) {
		return error(401, { message: 'unauthorized' });
	}

	const result = await db
		.select()
		.from(table.modList)
		.rightJoin(table.mod, eq(table.modList.id, table.mod.modlist))
		.where(eq(table.modList.id, event.params.id));
	if (result.length === 0) {
		return error(404, { message: 'modlist not found' });
	}

	// Get user credentials for factorio API
	const user = await db
		.select({
			factorioUsername: table.user.factorioUsername,
			factorioToken: table.user.factorioToken
		})
		.from(table.user)
		.where(eq(table.user.id, event.locals.session.userId))
		.get();

	// Handle search query from URL parameters
	const searchQuery = event.url.searchParams.get('q');
	let searchResults: any[] = [];
	let searchError: string | null = null;

	if (
		searchQuery &&
		searchQuery.trim().length > 0 &&
		user?.factorioUsername &&
		user?.factorioToken
	) {
		try {
			const searchUrl = 'https://mods.factorio.com/api/search';
			const requestBody = {
				query: searchQuery.trim(),
				username: user.factorioUsername,
				token: user.factorioToken
			};
			console.log(requestBody);

			const response = await fetch(searchUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				console.error('Factorio API error:', response.status, response.statusText);
				searchError = 'Failed to search mods';
			} else {
				const data = await response.json();
				searchResults = data.results || [];
			}
		} catch (error) {
			console.error('Search error:', error);
			searchError = 'Failed to search mods';
		}
	}

	return {
		modlist: result[0].modlist,
		mods: result.map((r) => r.mod),
		hasFactorioCredentials: !!(user?.factorioUsername && user?.factorioToken),
		searchQuery: searchQuery || '',
		searchResults,
		searchError
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
		return { success: true, modId: modID, newStatus: !mod.enabled };
	},

	addMod: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		const formData = await event.request.formData();
		const modName = formData.get('modName')?.toString();
		const modlistId = event.params.id;

		if (!modName || !modlistId) {
			return fail(400, { message: 'Mod name and modlist ID are required' });
		}

		try {
			// Check if mod already exists in this modlist
			const existingMod = await db
				.select()
				.from(table.mod)
				.where(and(eq(table.mod.modlist, modlistId), eq(table.mod.name, modName)))
				.get();

			if (existingMod) {
				return fail(400, { message: 'Mod already exists in this modlist' });
			}

			// Generate ID and add mod
			const modId = crypto.randomUUID();
			await db.insert(table.mod).values({
				id: modId,
				modlist: modlistId,
				name: modName,
				enabled: true
			});

			return { success: true, message: `Added ${modName} to modlist` };
		} catch (error) {
			console.error('Add mod error:', error);
			return fail(500, { message: 'Failed to add mod' });
		}
	},

	removeMod: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		const formData = await event.request.formData();
		const modName = formData.get('modName')?.toString();
		const modlistId = event.params.id;

		if (!modName || !modlistId) {
			return fail(400, { message: 'Mod name and modlist ID are required' });
		}

		try {
			// Find and remove the mod from this modlist
			const deletedMod = await db
				.delete(table.mod)
				.where(and(eq(table.mod.modlist, modlistId), eq(table.mod.name, modName)))
				.returning();

			if (deletedMod.length === 0) {
				return fail(404, { message: 'Mod not found in this modlist' });
			}

			return { success: true, message: `Removed ${modName} from modlist` };
		} catch (error) {
			console.error('Remove mod error:', error);
			return fail(500, { message: 'Failed to remove mod' });
		}
	}
};
