import { error, fail, isActionFailure, redirect } from '@sveltejs/kit';
import { and, eq, getTableColumns, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
	compareVersions,
	inspectDependencies,
	isBundledMod,
	supportsFactorio
} from '$lib/dependencies';
import { listOwnerKey } from '$lib/server/accounts';
import { db, userHasModlistAccess } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { ensureModlistAccess } from '$lib/server/guards';
import { modMetadataValues } from '$lib/server/mod-metadata';
import { validModName } from '$lib/server/mod-names';
import { repairProgress, startModlistRepair } from '$lib/server/modlist-repair';
import { getPortalMod } from '$lib/server/portal-cache';
import { publishModlistEvent } from '$lib/server/realtime';
import { parseDependencies, validateDependencies } from '$lib/server/services/dependencies';
import type { Actions, PageServerLoad } from './$types';

const { description: _description, tags: _tags, ...modColumns } = getTableColumns(table.mod);

async function requiredByEnabledMod(modlistId: string, modName: string): Promise<boolean> {
	const dependentMods = await db
		.select({ name: table.mod.name, dependencies: table.mod.dependencies })
		.from(table.mod)
		.where(
			and(
				eq(table.mod.modlist, modlistId),
				eq(table.mod.enabled, true),
				or(isNull(table.mod.icebox), eq(table.mod.icebox, false)),
				isNotNull(table.mod.dependencies)
			)
		);
	return dependentMods.some(
		(mod) =>
			mod.name !== modName &&
			(inspectDependencies(mod.dependencies).errors.length > 0 ||
				parseDependencies(mod.dependencies).some(
					(dep) => dep.name === modName && dep.type === 'required'
				))
	);
}

export const load: PageServerLoad = async (event) => {
	event.depends('app:modlist');
	const { canManageServer } = await event.parent();
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
		hasAccess = await userHasModlistAccess(event.locals.session.userId, event.params.id);
	}

	if (!hasAccess && !modlistVisibility.publicRead) {
		return error(403, { message: 'Access denied' });
	}

	let hasFactorioCredentials = false;
	if (event.locals.session) {
		const user = await db
			.select({
				factorioUsername: table.user.factorioUsername,
				factorioToken: table.user.factorioToken
			})
			.from(table.user)
			.where(eq(table.user.id, event.locals.session.userId))
			.get();

		if (user?.factorioUsername && user?.factorioToken) {
			hasFactorioCredentials = true;
		}
	}

	const result = await db
		.select({
			modlist: table.modList,
			mod: modColumns,
			updatedBy: {
				id: table.user.id,
				username: table.user.username
			}
		})
		.from(table.modList)
		.leftJoin(table.mod, eq(table.modList.id, table.mod.modlist))
		.leftJoin(table.user, eq(table.mod.updatedBy, table.user.id))
		.where(eq(table.modList.id, event.params.id));
	const list = result[0]?.modlist;
	if (!list) {
		return error(404, { message: 'modlist not found' });
	}

	// Process mods and convert timestamps to proper Date objects
	const processedMods = result.flatMap((r) => {
		const mod = r.mod;
		if (!mod || mod.name === 'base') return [];
		return [
			{
				...mod,
				lastUpdated: mod.lastUpdated ? new Date(mod.lastUpdated) : null,
				lastFetched: mod.lastFetched ? new Date(mod.lastFetched) : null,
				updatedBy: r.updatedBy
			}
		];
	});

	// Separate mods into active list and icebox list
	const iceboxMods = processedMods.filter((m) => m.icebox);
	const activeMods = processedMods.filter((m) => !m.icebox);

	// Dependency validation only considers active mods
	const dependencyValidation = validateDependencies(activeMods, list.factorioVersion);

	// Fetch collaborators
	const collaborators = await db
		.select({ id: table.user.id, username: table.user.username })
		.from(table.modListCollaborator)
		.innerJoin(table.user, eq(table.user.id, table.modListCollaborator.userId))
		.where(eq(table.modListCollaborator.modlistId, event.params.id));

	return {
		canManageServer,
		curationAvailable: hasAccess && Boolean((await listOwnerKey(event.params.id))?.apiKey),
		modlist: list,
		mods: activeMods,
		hasFactorioCredentials,
		dependencyValidation,
		repair: hasAccess ? repairProgress(event.params.id) : null,
		iceboxMods,
		collaborators,
		currentUserId: event.locals.session?.userId
	};
};

const modlistActions: Actions = {
	toggleStatus: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
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
			.where(and(eq(table.mod.id, modID), eq(table.mod.modlist, event.params.id)))
			.get();

		if (!mod) {
			return fail(404);
		}

		// If we are attempting to disable this mod, ensure it is not an essential mod and
		// not a required dependency of another enabled mod
		if (mod.enabled && mod.essential) {
			return fail(400, { message: 'Cannot disable an essential mod' });
		}

		if (mod.enabled) {
			if (await requiredByEnabledMod(mod.modlist, mod.name)) {
				return fail(400, { message: 'Cannot disable a required dependency' });
			}
		}

		const updated = await db
			.update(table.mod)
			.set({ enabled: !mod.enabled, updatedBy: userId })
			.where(
				and(
					eq(table.mod.id, modID),
					eq(table.mod.modlist, event.params.id),
					mod.enabled === null ? isNull(table.mod.enabled) : eq(table.mod.enabled, mod.enabled),
					...(mod.enabled ? [or(isNull(table.mod.essential), eq(table.mod.essential, false))] : [])
				)
			)
			.returning({ id: table.mod.id })
			.get();
		if (!updated)
			return fail(409, { message: 'Mod changed while updating. Refresh and try again.' });

		// Notify collaborators via SSE
		publishModlistEvent(mod.modlist, 'mod-toggled', { modId: modID, enabled: !mod.enabled });

		return { success: true, modId: modID, newStatus: !mod.enabled };
	},

	addMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const formData = await event.request.formData();
		const modName = formData.get('modName')?.toString();
		const modlistId = event.params.id;

		if (!modName || !modlistId) {
			return fail(400, { message: 'Mod name and modlist ID are required' });
		}
		if (!validModName(modName)) return fail(400, { message: 'Invalid mod name' });

		try {
			// Check if mod already exists in this modlist
			const existingMod = await db
				.select()
				.from(table.mod)
				.where(and(eq(table.mod.modlist, modlistId), eq(table.mod.name, modName)))
				.get();

			if (existingMod) {
				if (!existingMod.icebox)
					return fail(400, { message: 'Mod already exists in this modlist' });
				await db
					.update(table.mod)
					.set({ enabled: true, icebox: false, updatedBy: userId })
					.where(and(eq(table.mod.id, existingMod.id), eq(table.mod.modlist, modlistId)));
				publishModlistEvent(modlistId, 'icebox-activated', { modId: existingMod.id });
				return { success: true, modId: existingMod.id };
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

			// Broadcast new mod addition
			publishModlistEvent(modlistId, 'mod-added', { name: modName });

			return { success: true, modName, message: `Added ${modName} to modlist` };
		} catch (error) {
			console.error('Add mod error:', error);
			return fail(500, { message: 'Failed to add mod' });
		}
	},

	addIceboxMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const formData = await event.request.formData();
		const modName = formData.get('modName')?.toString();
		const modlistId = event.params.id;

		if (!modName || !modlistId) {
			return fail(400, { message: 'Mod name and modlist ID are required' });
		}
		if (!validModName(modName)) return fail(400, { message: 'Invalid mod name' });

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
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;

		const formData = await event.request.formData();
		const modName = formData.get('modName')?.toString();
		const modlistId = event.params.id;

		if (!modName || !modlistId) {
			return fail(400, { message: 'Mod name and modlist ID are required' });
		}

		try {
			const mod = await db
				.select({ essential: table.mod.essential })
				.from(table.mod)
				.where(and(eq(table.mod.modlist, modlistId), eq(table.mod.name, modName)))
				.get();
			if (!mod) return fail(404, { message: 'Mod not found in this modlist' });
			if (mod.essential) return fail(400, { message: 'Cannot remove an essential mod' });
			if (await requiredByEnabledMod(modlistId, modName)) {
				return fail(400, { message: 'Cannot remove a required dependency' });
			}
			// Find and remove the mod from this modlist
			const deletedMod = await db
				.delete(table.mod)
				.where(
					and(
						eq(table.mod.modlist, modlistId),
						eq(table.mod.name, modName),
						or(isNull(table.mod.essential), eq(table.mod.essential, false))
					)
				)
				.returning();

			if (deletedMod.length === 0) {
				return fail(409, { message: 'Mod changed while removing. Refresh and try again.' });
			}

			// Broadcast removal
			publishModlistEvent(modlistId, 'mod-removed', { name: modName });

			return { success: true, modName, message: `Removed ${modName} from modlist` };
		} catch (error) {
			console.error('Remove mod error:', error);
			return fail(500, { message: 'Failed to remove mod' });
		}
	},

	moveToIcebox: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
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
				.where(and(eq(table.mod.id, modId), eq(table.mod.modlist, event.params.id)))
				.get();

			if (!mod) {
				return fail(404, { message: 'Mod not found' });
			}

			// Only allow moving to icebox if the mod is currently disabled
			if (mod.enabled) {
				return fail(400, { message: 'Disable the mod before moving it to icebox' });
			}

			const updated = await db
				.update(table.mod)
				.set({ icebox: true })
				.where(
					and(
						eq(table.mod.id, modId),
						eq(table.mod.modlist, event.params.id),
						eq(table.mod.enabled, false),
						or(isNull(table.mod.essential), eq(table.mod.essential, false))
					)
				)
				.returning({ id: table.mod.id })
				.get();
			if (!updated)
				return fail(409, { message: 'Mod changed while updating. Refresh and try again.' });

			// Notify collaborators via SSE
			publishModlistEvent(mod.modlist, 'mod-moved-to-icebox', { modId });

			return { success: true, modId };
		} catch (error) {
			console.error('Move to icebox error:', error);
			return fail(500, { message: 'Failed to move mod to icebox' });
		}
	},

	setModVersion: async (event) => {
		const access = await ensureModlistAccess(event, event.params.id);
		if (!access.success) return access.error;
		const form = await event.request.formData();
		const modId = form.get('modId')?.toString() ?? '';
		const version = form.get('version')?.toString() ?? '';
		if (compareVersions(version, version) === null)
			return fail(400, { message: 'Choose a valid release.' });
		const item = await db
			.select()
			.from(table.mod)
			.where(and(eq(table.mod.id, modId), eq(table.mod.modlist, event.params.id)))
			.get();
		if (!item) return fail(404, { message: 'Mod not found.' });
		if (isBundledMod(item.name))
			return fail(400, { message: 'Bundled mods use the installed Factorio version.' });
		let metadata: Awaited<ReturnType<typeof getPortalMod>>;
		try {
			metadata = await getPortalMod(item.name, true);
		} catch {
			return fail(503, { message: 'Release metadata is temporarily unavailable. Try again.' });
		}
		if (metadata.warning)
			return fail(503, { message: 'Current release metadata could not be verified. Try again.' });
		const info = metadata.data;
		const release = info?.releases.find((candidate) => candidate.version === version);
		if (!info || !release)
			return fail(400, { message: 'This release is unavailable. Refresh metadata and try again.' });
		if (inspectDependencies(JSON.stringify(release.info_json.dependencies)).errors.length)
			return fail(400, { message: 'This release has invalid dependency metadata.' });
		const result = await db.transaction(async (tx) => {
			const list = await tx
				.select()
				.from(table.modList)
				.where(eq(table.modList.id, event.params.id))
				.get();
			if (!list) return fail(404, { message: 'List not found.' });
			if (!supportsFactorio(release.info_json.factorio_version, list.factorioVersion))
				return fail(400, {
					message: `This release requires Factorio ${release.info_json.factorio_version}; the list targets ${list.factorioVersion}.`
				});
			const updated = await tx
				.update(table.mod)
				.set({ ...modMetadataValues(info, release, metadata.fetchedAt), updatedBy: access.userId })
				.where(and(eq(table.mod.id, modId), eq(table.mod.modlist, event.params.id)))
				.returning({ id: table.mod.id });
			return updated.length
				? { success: true }
				: fail(404, { message: 'Mod was removed while loading its releases.' });
		});
		if (!isActionFailure(result)) publishModlistEvent(event.params.id, 'mod-updated', { modId });
		return result;
	},

	refreshMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;

		const formData = await event.request.formData();
		const modId = formData.get('modId')?.toString();
		if (!modId) {
			return fail(400, { message: 'Mod ID is required' });
		}
		const mod = await db
			.select({ name: table.mod.name })
			.from(table.mod)
			.where(and(eq(table.mod.id, modId), eq(table.mod.modlist, event.params.id)))
			.get();
		if (!mod) return fail(404, { message: 'Mod not found in this modlist' });

		startModlistRepair(event.params.id, accessResult.userId, {
			refreshNames: [mod.name]
		});
		return { success: true, message: `Updating ${mod.name}` };
	},

	refreshAllMods: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;

		const modlistId = event.params.id;

		if (!modlistId) {
			return fail(400, { message: 'Modlist ID is required' });
		}

		startModlistRepair(modlistId, accessResult.userId, { refresh: true });
		return { success: true, message: 'Updating mods' };
	},

	setFactorioVersion: async (event) => {
		const access = await ensureModlistAccess(event, event.params.id);
		if (!access.success) return access.error;
		const version = (await event.request.formData()).get('version');
		if (typeof version !== 'string' || !/^\d{1,2}\.\d{1,2}$/u.test(version))
			return fail(400, { message: 'Invalid Factorio version' });
		await db
			.update(table.modList)
			.set({ factorioVersion: version })
			.where(eq(table.modList.id, event.params.id));
		return { success: true };
	},

	updateModlistName: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const formData = await event.request.formData();
		const newName = formData.get('name')?.toString()?.trim();
		const modlistId = event.params.id;

		if (!newName || !modlistId) {
			return fail(400, { message: 'Enter a name for this list' });
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
		const accessResult = await ensureModlistAccess(event, event.params.id);
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
			publishModlistEvent(modlistId, 'modlist-deleted');
		} catch (error) {
			console.error('Delete modlist error:', error);
			return fail(500, { message: 'Failed to delete modlist' });
		}

		// Redirect after successful deletion (outside try-catch to avoid catching the redirect)
		return redirect(303, '/modlists');
	},

	shareAdd: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const modlistId = event.params.id;

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
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const modlistId = event.params.id;
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
		publishModlistEvent(modlistId, 'access-revoked', { userId: userIdToRemove });

		return { success: true };
	},

	// Toggle global read-only sharing
	sharePublic: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
		if (!accessResult.success) return accessResult.error;
		const userId = accessResult.userId;

		const modlistId = event.params.id;

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
		publishModlistEvent(modlistId, 'visibility-changed', { publicRead: enabled });

		return { success: true, publicRead: enabled };
	},

	// Toggle the essential (locked) status of a mod
	toggleEssential: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
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
			.where(and(eq(table.mod.id, modID), eq(table.mod.modlist, event.params.id)))
			.get();

		if (!mod) {
			return fail(404);
		}

		// Determine new essential state
		const newEssential = !mod.essential;

		// If making essential, also ensure the mod is enabled
		const updated = await db
			.update(table.mod)
			.set({
				essential: newEssential,
				enabled: newEssential ? true : sql`${table.mod.enabled}`,
				...(newEssential ? { icebox: false } : {}),
				updatedBy: userId
			})
			.where(
				and(
					eq(table.mod.id, modID),
					eq(table.mod.modlist, event.params.id),
					mod.essential
						? eq(table.mod.essential, true)
						: or(isNull(table.mod.essential), eq(table.mod.essential, false))
				)
			)
			.returning({ id: table.mod.id })
			.get();
		if (!updated)
			return fail(409, { message: 'Mod changed while updating. Refresh and try again.' });

		// Notify collaborators via SSE
		publishModlistEvent(mod.modlist, 'mod-essential-toggled', {
			modId: modID,
			essential: newEssential
		});

		return { success: true, modId: modID, newEssential };
	},

	// Activate a mod from icebox into the regular list
	activateMod: async (event) => {
		const accessResult = await ensureModlistAccess(event, event.params.id);
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
				.where(and(eq(table.mod.id, modId), eq(table.mod.modlist, event.params.id)))
				.get();

			if (!mod) {
				return fail(404, { message: 'Mod not found' });
			}

			await db
				.update(table.mod)
				.set({ icebox: false, enabled: true, updatedBy: accessResult.userId })
				.where(and(eq(table.mod.id, modId), eq(table.mod.modlist, event.params.id)));

			publishModlistEvent(mod.modlist, 'icebox-activated', { modId });

			return { success: true, modId };
		} catch (error) {
			console.error('Activate mod error:', error);
			return fail(500, { message: 'Failed to activate mod' });
		}
	}
};

const repairActions = new Set([
	'addMod',
	'addIceboxMod',
	'toggleStatus',
	'toggleEssential',
	'activateMod',
	'removeMod',
	'moveToIcebox',
	'setFactorioVersion',
	'setModVersion'
]);
export const actions: Actions = Object.fromEntries(
	Object.entries(modlistActions).map(([name, action]) => [
		name,
		async (event) => {
			const result = await action(event);
			if (
				!isActionFailure(result) &&
				repairActions.has(name) &&
				event.locals.session &&
				event.params.id
			)
				startModlistRepair(event.params.id, event.locals.session.userId, { changed: true });
			return result;
		}
	])
);
