import { db } from '$lib/server/db';
import { eq, and, like, isNotNull } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';
import { updateModCache, refreshModsCache, userHasModlistAccess } from '$lib/server/db';
import { publishModlistEvent } from '$lib/server/realtime';
import type { PageServerLoad } from './$types';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { parseDependencies, validateDependencies } from '$lib/server/services/dependencies';
import { ensureModlistAccess } from '$lib/server/guards';
import { factorioApiLimiter } from '$lib/server/rate-limiter';

type SearchResult = {
	name: string;
	title: string;
	/** Owner/author username of the mod */
	owner: string;
	downloads_count?: number;
	updated_at?: string;
	created_at?: string;
	[key: string]: unknown;
};

export const load: PageServerLoad = async (event) => {
	// Determine if this modlist is public read-only
	const modlistVisibility = await db
		.select({ owner: table.modList.owner, publicRead: table.modList.publicRead })
		.from(table.modList)
		.where(eq(table.modList.id, event.params.id))
		.get();

	if (!modlistVisibility) {
		return error(404, { message: 'modlist not found' });
	}

	let hasAccess = false;
	if (event.locals.session) {
		hasAccess = await userHasModlistAccess(event.locals.session.userId, event.params.id as string);
	}

	if (!hasAccess && !modlistVisibility.publicRead) {
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

	// Handle search query and filter parameters from URL
	const searchQuery = event.url.searchParams.get('q');
	const categoryFilter = event.url.searchParams.get('category');
	const versionFilter = event.url.searchParams.get('version');
	const tagFilters = event.url.searchParams.getAll('tag');

	// Pagination parameters (defaults: page 1, page_size 30)
	let currentPage = parseInt(event.url.searchParams.get('page') ?? '1', 10);
	if (Number.isNaN(currentPage) || currentPage < 1) currentPage = 1;
	const pageSize = parseInt(event.url.searchParams.get('page_size') ?? '30', 10);
	const effectivePageSize = Number.isNaN(pageSize) || pageSize < 1 ? 30 : pageSize;

	let searchResults: SearchResult[] = [];
	let searchError: string | null = null;
	let totalPages = 1;

	if (searchQuery && searchQuery.trim().length > 0) {
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
				sortAttrParam &&
				validSortAttributes.includes(sortAttrParam as (typeof validSortAttributes)[number])
					? (sortAttrParam as (typeof validSortAttributes)[number])
					: 'last_updated_at';

			const requestBody: Record<string, unknown> = {
				query: searchQuery.trim(),
				show_deprecated: false,
				sort_attribute: sortAttribute,
				exclude_category: ['internal']
			};

			// Pagination
			requestBody.page = currentPage;
			requestBody.page_size = effectivePageSize;

			// Forward filter parameters directly to the Factorio search API when provided
			if (categoryFilter) requestBody.category = categoryFilter;
			if (versionFilter && versionFilter !== 'any') requestBody.factorio_version = versionFilter;
			if (tagFilters.length > 0) requestBody.tag = tagFilters;

			const response = await factorioApiLimiter.fetch(searchUrl, {
				method: 'POST',
				signal: AbortSignal.timeout(45000), // 45 second timeout for search
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'FactorioManager/1.0'
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				console.error('Factorio API error:', response.status, response.statusText);
				searchError = 'Failed to search mods';
			} else {
				const data = await response.json();
				searchResults = data.results || [];

				// Compute pagination info if available
				if (typeof data.page_count === 'number') {
					totalPages = data.page_count;
				} else if (typeof data.result_count === 'number' && typeof data.page_size === 'number') {
					totalPages = Math.max(1, Math.ceil(data.result_count / data.page_size));
				} else {
					// Fallback: assume there might be more pages if we received full page size
					totalPages = searchResults.length === effectivePageSize ? currentPage + 1 : currentPage;
				}

				// Client-side filtering and sorting based on additional query params
				const sortField = event.url.searchParams.get('sort');
				const sortOrder = event.url.searchParams.get('order') ?? 'desc';

				if (sortField) {
					searchResults.sort((a: SearchResult, b: SearchResult) => {
						const getSortValue = (obj: SearchResult): number | string => {
							switch (sortField) {
								case 'downloads':
									return obj.downloads_count || 0;
								case 'updated':
									return new Date(obj.updated_at || 0).getTime();
								case 'created':
									return new Date(obj.created_at || 0).getTime();
								default:
									return obj.title ?? obj.name ?? '';
							}
						};
						const av = getSortValue(a);
						const bv = getSortValue(b);
						if (av === bv) return 0;
						let cmp: number;
						if (typeof av === 'number' && typeof bv === 'number') {
							cmp = av - bv;
						} else {
							cmp = String(av).localeCompare(String(bv));
						}
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

	// Separate mods into active list and icebox list
	const iceboxMods = processedMods.filter((m) => m.icebox);
	const activeMods = processedMods.filter((m) => !m.icebox);

	// Background refresh for mods that haven't been cached recently (older than 1 hour)
	const now = new Date();
	const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

	const modsNeedingRefresh = activeMods.filter(
		(mod) => !mod.lastFetched || mod.lastFetched < oneHourAgo
	);

	if (modsNeedingRefresh.length > 0) {
		Promise.all(modsNeedingRefresh.map((mod) => updateModCache(mod.id, mod.name))).catch(
			console.error
		);
	}

	// Dependency validation only considers active mods
	const dependencyValidation = validateDependencies(activeMods);

	// Fetch collaborators
	const collaborators = await db
		.select({ id: table.user.id, username: table.user.username })
		.from(table.modListCollaborator)
		.innerJoin(table.user, eq(table.user.id, table.modListCollaborator.userId))
		.where(eq(table.modListCollaborator.modlistId, event.params.id));

	return {
		modlist: result[0].modlist,
		mods: activeMods,
		hasFactorioCredentials: false,
		searchQuery: searchQuery || '',
		searchResults,
		searchError,
		dependencyValidation,
		iceboxMods,
		collaborators,
		currentUserId: event.locals.session?.userId,
		sessionToken: event.cookies.get('auth-session'),
		currentPage,
		totalPages
	};
};

export const actions: Actions = {
	toggleStatus: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

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
			// Optimized dependency check: only fetch mods that might depend on this mod
			// Use SQL LIKE to search for the mod name in dependencies JSON
			const dependentMods = await db
				.select({ name: table.mod.name, dependencies: table.mod.dependencies })
				.from(table.mod)
				.where(
					and(
						eq(table.mod.modlist, mod.modlist),
						eq(table.mod.enabled, true),
						isNotNull(table.mod.dependencies),
						// SQL LIKE to quickly filter mods that might contain this dependency
						like(table.mod.dependencies, `%"${mod.name}"%`)
					)
				);

			// Only parse dependencies for mods that potentially depend on this mod
			const isRequired = dependentMods.some((m) => {
				if (m.name === mod.name) return false;
				return parseDependencies(m.dependencies).some(
					(d) => d.name === mod.name && d.type !== 'optional'
				);
			});

			if (isRequired) {
				return fail(400, { message: 'Cannot disable a required dependency' });
			}
		}

		await db
			.update(table.mod)
			.set({ enabled: !mod.enabled, updatedBy: userId })
			.where(eq(table.mod.id, modID));

		// Notify collaborators via SSE
		publishModlistEvent(mod.modlist, 'mod-toggled', { modId: modID, enabled: !mod.enabled });

		return { success: true, modId: modID, newStatus: !mod.enabled };
	},

	addMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

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
				enabled: true,
				updatedBy: userId
			});

			// Fetch mod information from API in background
			updateModCache(modId, modName);

			// Broadcast new mod addition
			publishModlistEvent(modlistId, 'mod-added', { name: modName });

			return { success: true, message: `Added ${modName} to modlist` };
		} catch (error) {
			console.error('Add mod error:', error);
			return fail(500, { message: 'Failed to add mod' });
		}
	},

	addIceboxMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

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

			// Generate ID and add mod to icebox
			const modId = crypto.randomUUID();
			await db.insert(table.mod).values({
				id: modId,
				modlist: modlistId,
				name: modName,
				enabled: false,
				icebox: true,
				updatedBy: userId
			});

			// Broadcast new icebox addition (optional)
			publishModlistEvent(modlistId, 'icebox-added', { name: modName });

			return { success: true, modName, message: `Added ${modName} to icebox` };
		} catch (error) {
			console.error('Add icebox mod error:', error);
			return fail(500, { message: 'Failed to add mod to icebox' });
		}
	},

	removeMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;

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

	moveToIcebox: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;

		const formData = await event.request.formData();
		const modId = formData.get('modId')?.toString();

		if (!modId) {
			return fail(400, { message: 'Mod ID is required' });
		}

		try {
			// Ensure the mod exists and belongs to this modlist
			const mod = await db
				.select({ enabled: table.mod.enabled, modlist: table.mod.modlist })
				.from(table.mod)
				.where(eq(table.mod.id, modId))
				.get();

			if (!mod) {
				return fail(404, { message: 'Mod not found' });
			}

			// Only allow moving to icebox if the mod is currently disabled
			if (mod.enabled) {
				return fail(400, { message: 'Disable the mod before moving it to icebox' });
			}

			await db.update(table.mod).set({ icebox: true }).where(eq(table.mod.id, modId));

			// Notify collaborators via SSE
			publishModlistEvent(mod.modlist, 'mod-moved-to-icebox', { modId });

			return { success: true, modId };
		} catch (error) {
			console.error('Move to icebox error:', error);
			return fail(500, { message: 'Failed to move mod to icebox' });
		}
	},

	refreshMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;

		const formData = await event.request.formData();
		const modId = formData.get('modId')?.toString();
		const modName = formData.get('modName')?.toString();

		if (!modId || !modName) {
			return fail(400, { message: 'Mod ID and name are required' });
		}

		try {
			// Update mod cache
			await updateModCache(modId, modName);

			return { success: true, message: `Refreshed ${modName} information` };
		} catch (error) {
			console.error('Refresh mod error:', error);
			return fail(500, { message: 'Failed to refresh mod information' });
		}
	},

	refreshAllMods: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;

		const modlistId = event.params.id;

		if (!modlistId) {
			return fail(400, { message: 'Modlist ID is required' });
		}

		try {
			// Refresh all mods in the list
			await refreshModsCache(modlistId);

			return { success: true, message: 'Refreshed all mod information' };
		} catch (error) {
			console.error('Refresh all mods error:', error);
			return fail(500, { message: 'Failed to refresh mod information' });
		}
	},

	updateModlistName: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

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
				.where(and(eq(table.modList.id, modlistId), eq(table.modList.owner, userId)))
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
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const modlistId = event.params.id;

		if (!modlistId) {
			return fail(400, { message: 'Modlist ID is required' });
		}

		try {
			// Verify the modlist exists and belongs to the user
			const modlist = await db
				.select()
				.from(table.modList)
				.where(and(eq(table.modList.id, modlistId), eq(table.modList.owner, userId)))
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
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

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

		if (!modlist || modlist.owner !== userId) {
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
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const modlistId = event.params.id as string;
		const formData = await event.request.formData();
		const userIdToRemove = formData.get('userId')?.toString();

		if (!userIdToRemove) {
			return fail(400, { message: 'User ID is required' });
		}

		// Verify owner
		const modlist = await db
			.select({ owner: table.modList.owner })
			.from(table.modList)
			.where(eq(table.modList.id, modlistId))
			.get();

		if (!modlist || modlist.owner !== userId) {
			return fail(403, { message: 'Only the owner can remove shares' });
		}

		await db
			.delete(table.modListCollaborator)
			.where(
				and(
					eq(table.modListCollaborator.modlistId, modlistId),
					eq(table.modListCollaborator.userId, userIdToRemove)
				)
			);

		return { success: true };
	},

	// Toggle global read-only sharing
	sharePublic: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const modlistId = event.params.id as string;

		// Verify owner
		const modlist = await db
			.select({ owner: table.modList.owner })
			.from(table.modList)
			.where(eq(table.modList.id, modlistId))
			.get();

		if (!modlist || modlist.owner !== userId) {
			return fail(403, { message: 'Only the owner can change public sharing' });
		}

		const formData = await event.request.formData();
		const enabledStr = formData.get('enabled')?.toString() ?? 'false';
		const enabled = enabledStr === 'true' || enabledStr === '1' || enabledStr === 'on';

		await db
			.update(table.modList)
			.set({ publicRead: enabled })
			.where(eq(table.modList.id, modlistId));

		return { success: true, publicRead: enabled };
	},

	// Toggle the essential (locked) status of a mod
	toggleEssential: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

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
				updatedBy: userId
			})
			.where(eq(table.mod.id, modID));

		// Notify collaborators via SSE
		publishModlistEvent(mod.modlist, 'mod-essential-toggled', {
			modId: modID,
			essential: newEssential
		});

		return { success: true, modId: modID, newEssential };
	},

	// Activate a mod from icebox into the regular list
	activateMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id as string);
		if (!accessResult.success) return accessResult.error;

		const formData = await event.request.formData();
		const modId = formData.get('modId')?.toString();

		if (!modId) {
			return fail(400, { message: 'Mod ID is required' });
		}

		try {
			// Ensure mod exists and belongs to modlist
			const mod = await db
				.select({ modlist: table.mod.modlist })
				.from(table.mod)
				.where(eq(table.mod.id, modId))
				.get();

			if (!mod) {
				return fail(404, { message: 'Mod not found' });
			}

			await db.update(table.mod).set({ icebox: false }).where(eq(table.mod.id, modId));

			publishModlistEvent(mod.modlist, 'icebox-activated', { modId });

			return { success: true, modId };
		} catch (error) {
			console.error('Activate mod error:', error);
			return fail(500, { message: 'Failed to activate mod' });
		}
	}
};
