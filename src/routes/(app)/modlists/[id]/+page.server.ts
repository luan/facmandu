import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';
import { updateModCache, refreshModsCache, userHasModlistAccess } from '$lib/server/db';
import { publishModlistEvent } from '$lib/server/realtime';
import type { PageServerLoad } from './$types';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.session) {
		return error(401, { message: 'unauthorized' });
	}

	// Check user has access to this modlist (owner or collaborator)
	const hasAccess = await userHasModlistAccess(
		event.locals.session.userId,
		event.params.id as string
	);
	if (!hasAccess) {
		return error(403, { message: 'Access denied' });
	}

	const result = await db
		.select({
			modlist: table.modList,
			mod: table.mod,
			updatedBy: {
				id: table.user.id,
				username: table.user.username
			}
		})
		.from(table.modList)
		.rightJoin(table.mod, eq(table.modList.id, table.mod.modlist))
		.leftJoin(table.user, eq(table.mod.updatedBy, table.user.id))
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

	// Handle search query and filter parameters from URL
	const searchQuery = event.url.searchParams.get('q');
	const categoryFilter = event.url.searchParams.get('category');
	const versionFilter = event.url.searchParams.get('version');
	const tagFilters = event.url.searchParams.getAll('tag');
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
			// Determine desired sort attribute for Factorio API
			const sortAttrParam = event.url.searchParams.get('sort_attr');
			const validSortAttributes = [
				'relevancy',
				'most_downloads',
				'last_updated_at',
				'trending'
			] as const;
			const sortAttribute =
				sortAttrParam && validSortAttributes.includes(sortAttrParam as any)
					? (sortAttrParam as (typeof validSortAttributes)[number])
					: 'last_updated_at';

			const requestBody: Record<string, unknown> = {
				query: searchQuery.trim(),
				username: user.factorioUsername,
				token: user.factorioToken,
				show_deprecated: false,
				sort_attribute: sortAttribute,
				exclude_category: ['internal']
			};

			// Forward filter parameters directly to the Factorio search API when provided
			if (categoryFilter) requestBody.category = categoryFilter;
			if (versionFilter && versionFilter !== 'any') requestBody.factorio_version = versionFilter;
			if (tagFilters.length > 0) requestBody.tag = tagFilters;

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

				// Client-side filtering and sorting based on additional query params
				const sortField = event.url.searchParams.get('sort');
				const sortOrder = event.url.searchParams.get('order') ?? 'desc';

				if (sortField) {
					searchResults.sort((a: any, b: any) => {
						const getSortValue = (obj: any) => {
							switch (sortField) {
								case 'downloads':
									return obj.downloads_count || 0;
								case 'updated':
									return new Date(obj.updated_at || 0).getTime();
								case 'created':
									return new Date(obj.created_at || 0).getTime();
								default:
									return obj.title || obj.name;
							}
						};
						const av = getSortValue(a);
						const bv = getSortValue(b);
						if (av === bv) return 0;
						const cmp = av > bv ? 1 : -1;
						return sortOrder === 'asc' ? cmp : -cmp;
					});
				}
			}
		} catch (error) {
			console.error('Search error:', error);
			searchError = 'Failed to search mods';
		}
	}

	// Process mods and convert timestamps to proper Date objects
	const processedMods = result.map((r) => {
		const mod = r.mod;
		return {
			...mod,
			lastUpdated: mod.lastUpdated ? new Date(mod.lastUpdated) : null,
			lastFetched: mod.lastFetched ? new Date(mod.lastFetched) : null,
			updatedBy: r.updatedBy
		};
	});

	// Background refresh for mods that haven't been cached recently (older than 1 hour)
	const now = new Date();
	const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

	const modsNeedingRefresh = processedMods.filter(
		(mod) => !mod.lastFetched || mod.lastFetched < oneHourAgo
	);

	if (modsNeedingRefresh.length > 0 && user?.factorioUsername && user?.factorioToken) {
		// Refresh in background without blocking the response
		Promise.all(
			modsNeedingRefresh.map((mod) =>
				updateModCache(
					mod.id,
					mod.name,
					user.factorioUsername || undefined,
					user.factorioToken || undefined
				)
			)
		).catch(console.error);
	}

	// Dependency validation
	const dependencyValidation = validateDependencies(processedMods);

	// Fetch collaborators
	const collaborators = await db
		.select({ id: table.user.id, username: table.user.username })
		.from(table.modListCollaborator)
		.innerJoin(table.user, eq(table.user.id, table.modListCollaborator.userId))
		.where(eq(table.modListCollaborator.modlistId, event.params.id));

	return {
		modlist: result[0].modlist,
		mods: processedMods,
		hasFactorioCredentials: !!(user?.factorioUsername && user?.factorioToken),
		searchQuery: searchQuery || '',
		searchResults,
		searchError,
		dependencyValidation,
		collaborators,
		currentUserId: event.locals.session.userId,
		sessionToken: event.cookies.get('auth-session')
	};
};

// Dependency validation function
function validateDependencies(mods: any[]) {
	const enabledMods = mods.filter((mod) => mod.enabled);
	const enabledModNames = new Set(enabledMods.map((mod) => mod.name));
	const missingDependencies: string[] = [];
	const conflicts: Array<{ mod: string; conflictsWith: string }> = [];
	const conflictingMods = new Set<string>();

	// Parse dependency string and extract dependencies
	function parseDependencies(
		dependencyString: string | null
	): Array<{ name: string; type: 'required' | 'optional' | 'conflict' }> {
		if (!dependencyString) return [];

		try {
			const deps = JSON.parse(dependencyString);
			return deps.map((dep: string) => {
				const [name, _version] = dep.split(/>=|>|<=|<|=/);
				if (name.startsWith('!')) {
					return { name: name.slice(1).trim(), type: 'conflict' as const };
				} else if (name.startsWith('?') || name.startsWith('(?)')) {
					return { name: name.slice(1).trim(), type: 'optional' as const };
				} else if (name.startsWith('~')) {
					return { name: name.slice(1).trim(), type: 'required' as const };
				} else {
					return { name: name.trim(), type: 'required' as const };
				}
			});
		} catch {
			return [];
		}
	}

	// Check each enabled mod's dependencies
	for (const mod of enabledMods) {
		const dependencies = parseDependencies(mod.dependencies);

		for (const dep of dependencies) {
			if (dep.type === 'required') {
				// Skip 'base' dependency as it's always present
				const baseMods = new Set(['base', 'space-age', 'quality', 'elevated-rails']);
				if (!baseMods.has(dep.name) && !enabledModNames.has(dep.name)) {
					if (!missingDependencies.includes(dep.name)) {
						missingDependencies.push(dep.name);
					}
				}
			} else if (dep.type === 'conflict') {
				if (enabledModNames.has(dep.name)) {
					conflicts.push({
						mod: mod.name,
						conflictsWith: dep.name
					});
					conflictingMods.add(mod.name);
					conflictingMods.add(dep.name);
				}
			}
		}
	}

	return {
		missingDependencies,
		conflicts,
		conflictingMods: Array.from(conflictingMods)
	};
}

export const actions: Actions = {
	toggleStatus: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		// Access check
		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
		}

		const formData = await event.request.formData();
		const modID = formData.get('modid')?.toString();
		if (!modID) {
			return fail(400);
		}
		const mod = await db
			.select({
				id: table.mod.id,
				name: table.mod.name,
				enabled: table.mod.enabled,
				essential: table.mod.essential,
				modlist: table.mod.modlist
			})
			.from(table.mod)
			.where(eq(table.mod.id, modID))
			.get();

		if (!mod) {
			return fail(404);
		}

		// If we are attempting to disable this mod, ensure it is not an essential mod and
		// not a required dependency of another enabled mod
		if (mod.essential) {
			return fail(400, { message: 'Cannot disable an essential mod' });
		}

		if (mod.enabled) {
			// Fetch all enabled mods in the same modlist (excluding the target mod)
			const enabledMods = await db
				.select({ name: table.mod.name, dependencies: table.mod.dependencies })
				.from(table.mod)
				.where(and(eq(table.mod.modlist, mod.modlist), eq(table.mod.enabled, true)));

			// Helper to parse dependencies (same logic as on client)
			const parseDependencies = (dependencyString: string | null): string[] => {
				if (!dependencyString) return [];
				try {
					const deps = JSON.parse(dependencyString) as string[];
					return deps
						.map((dep) => {
							const [raw] = dep.split(/>=|>|<=|<|=/);
							let name = raw.trim();

							// Conflicts (!) and incompatibilities (~) are still considered dependencies
							if (name.startsWith('!')) {
								return name.slice(1).trim();
							}
							if (name.startsWith('~')) {
								return name.slice(1).trim();
							}

							// Skip optional dependencies prefixed with ? or (?)
							if (name.startsWith('?') || name.startsWith('(?)')) {
								return null;
							}

							return name;
						})
						.filter((d): d is string => Boolean(d));
				} catch {
					return [];
				}
			};

			const isRequired = enabledMods.some((m) => {
				if (m.name === mod.name) return false;
				return parseDependencies(m.dependencies).includes(mod.name);
			});

			if (isRequired) {
				return fail(400, { message: 'Cannot disable a required dependency' });
			}
		}

		await db
			.update(table.mod)
			.set({ enabled: !mod.enabled, updatedBy: event.locals.session.userId })
			.where(eq(table.mod.id, modID));

		// Notify collaborators via SSE
		publishModlistEvent(mod.modlist, 'mod-toggled', { modId: modID, enabled: !mod.enabled });

		return { success: true, modId: modID, newStatus: !mod.enabled };
	},

	addMod: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
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

			// Get user credentials for API calls
			const user = await db
				.select({
					factorioUsername: table.user.factorioUsername,
					factorioToken: table.user.factorioToken
				})
				.from(table.user)
				.where(eq(table.user.id, event.locals.session.userId))
				.get();

			// Generate ID and add mod
			const modId = crypto.randomUUID();
			await db.insert(table.mod).values({
				id: modId,
				modlist: modlistId,
				name: modName,
				enabled: true,
				updatedBy: event.locals.session.userId
			});

			// Fetch mod information from API in background
			if (user?.factorioUsername && user?.factorioToken) {
				updateModCache(modId, modName, user.factorioUsername, user.factorioToken).catch(
					console.error
				);
			} else {
				updateModCache(modId, modName).catch(console.error);
			}

			// Broadcast new mod addition
			publishModlistEvent(modlistId, 'mod-added', { name: modName });

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

		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
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

			// Broadcast removal
			publishModlistEvent(modlistId, 'mod-removed', { name: modName });

			return { success: true, message: `Removed ${modName} from modlist` };
		} catch (error) {
			console.error('Remove mod error:', error);
			return fail(500, { message: 'Failed to remove mod' });
		}
	},

	refreshMod: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
		}

		const formData = await event.request.formData();
		const modId = formData.get('modId')?.toString();
		const modName = formData.get('modName')?.toString();

		if (!modId || !modName) {
			return fail(400, { message: 'Mod ID and name are required' });
		}

		try {
			// Get user credentials for API calls
			const user = await db
				.select({
					factorioUsername: table.user.factorioUsername,
					factorioToken: table.user.factorioToken
				})
				.from(table.user)
				.where(eq(table.user.id, event.locals.session.userId))
				.get();

			// Update mod cache
			if (user?.factorioUsername && user?.factorioToken) {
				await updateModCache(modId, modName, user.factorioUsername, user.factorioToken);
			} else {
				await updateModCache(modId, modName);
			}

			return { success: true, message: `Refreshed ${modName} information` };
		} catch (error) {
			console.error('Refresh mod error:', error);
			return fail(500, { message: 'Failed to refresh mod information' });
		}
	},

	refreshAllMods: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
		}

		const modlistId = event.params.id;

		if (!modlistId) {
			return fail(400, { message: 'Modlist ID is required' });
		}

		try {
			// Get user credentials for API calls
			const user = await db
				.select({
					factorioUsername: table.user.factorioUsername,
					factorioToken: table.user.factorioToken
				})
				.from(table.user)
				.where(eq(table.user.id, event.locals.session.userId))
				.get();

			// Refresh all mods in the list
			if (user?.factorioUsername && user?.factorioToken) {
				await refreshModsCache(modlistId, user.factorioUsername, user.factorioToken);
			} else {
				await refreshModsCache(modlistId);
			}

			return { success: true, message: 'Refreshed all mod information' };
		} catch (error) {
			console.error('Refresh all mods error:', error);
			return fail(500, { message: 'Failed to refresh mod information' });
		}
	},

	updateModlistName: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
		}

		const formData = await event.request.formData();
		const newName = formData.get('name')?.toString()?.trim();
		const modlistId = event.params.id;

		if (!newName || !modlistId) {
			return fail(400, { message: 'Modlist name and ID are required' });
		}

		if (newName.length < 1 || newName.length > 100) {
			return fail(400, { message: 'Modlist name must be between 1 and 100 characters' });
		}

		try {
			// Verify the modlist exists and belongs to the user
			const modlist = await db
				.select()
				.from(table.modList)
				.where(
					and(eq(table.modList.id, modlistId), eq(table.modList.owner, event.locals.session.userId))
				)
				.get();

			if (!modlist) {
				return fail(404, { message: 'Modlist not found or access denied' });
			}

			// Update the modlist name
			await db.update(table.modList).set({ name: newName }).where(eq(table.modList.id, modlistId));

			publishModlistEvent(modlistId, 'modlist-name-updated', { name: newName });

			return { success: true, message: 'Modlist name updated successfully' };
		} catch (error) {
			console.error('Update modlist name error:', error);
			return fail(500, { message: 'Failed to update modlist name' });
		}
	},

	deleteModlist: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
		}

		const modlistId = event.params.id;

		if (!modlistId) {
			return fail(400, { message: 'Modlist ID is required' });
		}

		try {
			// Verify the modlist exists and belongs to the user
			const modlist = await db
				.select()
				.from(table.modList)
				.where(
					and(eq(table.modList.id, modlistId), eq(table.modList.owner, event.locals.session.userId))
				)
				.get();

			if (!modlist) {
				return fail(404, { message: 'Modlist not found or access denied' });
			}

			// Delete the modlist (mods will be cascade deleted)
			await db.delete(table.modList).where(eq(table.modList.id, modlistId));
		} catch (error) {
			console.error('Delete modlist error:', error);
			return fail(500, { message: 'Failed to delete modlist' });
		}

		// Redirect after successful deletion (outside try-catch to avoid catching the redirect)
		return redirect(302, '/');
	},

	shareAdd: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		const modlistId = event.params.id as string;

		const formData = await event.request.formData();
		const username = formData.get('username')?.toString()?.trim();

		if (!username) {
			return fail(400, { message: 'Username is required' });
		}

		// Verify user is owner (only owner can share)
		const modlist = await db
			.select({ owner: table.modList.owner })
			.from(table.modList)
			.where(eq(table.modList.id, modlistId))
			.get();

		if (!modlist || modlist.owner !== event.locals.session.userId) {
			return fail(403, { message: 'Only the owner can share this modlist' });
		}

		// Check target user exists
		const targetUser = await db
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(table.user.username, username))
			.get();

		if (!targetUser) {
			return fail(404, { message: 'User not found' });
		}

		// Prevent sharing with self
		if (targetUser.id === modlist.owner) {
			return fail(400, { message: 'Cannot share with yourself (already owner)' });
		}

		// Check if already shared
		const existing = await db
			.select()
			.from(table.modListCollaborator)
			.where(
				and(
					eq(table.modListCollaborator.modlistId, modlistId),
					eq(table.modListCollaborator.userId, targetUser.id)
				)
			)
			.get();

		if (existing) {
			return fail(400, { message: 'User already has access' });
		}

		await db.insert(table.modListCollaborator).values({ modlistId, userId: targetUser.id });

		return { success: true };
	},

	shareRemove: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		const modlistId = event.params.id as string;
		const formData = await event.request.formData();
		const userId = formData.get('userId')?.toString();

		if (!userId) {
			return fail(400, { message: 'User ID is required' });
		}

		// Verify owner
		const modlist = await db
			.select({ owner: table.modList.owner })
			.from(table.modList)
			.where(eq(table.modList.id, modlistId))
			.get();

		if (!modlist || modlist.owner !== event.locals.session.userId) {
			return fail(403, { message: 'Only the owner can remove shares' });
		}

		await db
			.delete(table.modListCollaborator)
			.where(
				and(
					eq(table.modListCollaborator.modlistId, modlistId),
					eq(table.modListCollaborator.userId, userId)
				)
			);

		return { success: true };
	},

	// Toggle the essential (locked) status of a mod
	toggleEssential: async (event) => {
		if (!event.locals.session) {
			return fail(401);
		}

		// Access check
		if (!(await userHasModlistAccess(event.locals.session.userId, event.params.id as string))) {
			return fail(403);
		}

		const formData = await event.request.formData();
		const modID = formData.get('modid')?.toString();
		if (!modID) {
			return fail(400);
		}

		// Fetch current mod
		const mod = await db
			.select({
				id: table.mod.id,
				enabled: table.mod.enabled,
				essential: table.mod.essential,
				modlist: table.mod.modlist
			})
			.from(table.mod)
			.where(eq(table.mod.id, modID))
			.get();

		if (!mod) {
			return fail(404);
		}

		// Determine new essential state
		const newEssential = !mod.essential;

		// If making essential, also ensure the mod is enabled
		await db
			.update(table.mod)
			.set({
				essential: newEssential,
				enabled: newEssential ? true : mod.enabled,
				updatedBy: event.locals.session.userId
			})
			.where(eq(table.mod.id, modID));

		// Notify collaborators via SSE
		publishModlistEvent(mod.modlist, 'mod-essential-toggled', {
			modId: modID,
			essential: newEssential
		});

		return { success: true, modId: modID, newEssential };
	}
};
