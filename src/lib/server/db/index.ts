import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq, and } from 'drizzle-orm';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

const connectionUrl = env.TURSO_CONNECTION_URL || env.DATABASE_URL;
if (!connectionUrl) throw new Error('TURSO_CONNECTION_URL or DATABASE_URL must be set');

const clientConfig: Parameters<typeof createClient>[0] = { url: connectionUrl };
if (env.TURSO_AUTH_TOKEN) {
	clientConfig.authToken = env.TURSO_AUTH_TOKEN;
}

const client = createClient(clientConfig);
export const db = drizzle(client, { schema });

export interface FactorioModInfo {
	name: string;
	title: string;
	summary?: string;
	description?: string;
	category?: string;
	tags?: string[];
	thumbnail?: string;
	downloads_count?: number;
	updated_at?: string;
	latest_release?: {
		version: string;
		info_json: {
			dependencies?: string[];
			factorio_version?: string;
		};
	};
}

export async function fetchModInfo(modName: string): Promise<FactorioModInfo | null> {
	try {
		const url = `https://mods.factorio.com/api/mods/${modName}/full`;
		const response = await fetch(url);

		if (!response.ok) {
			console.error(`Failed to fetch mod info for ${modName}:`, response.status);
			return null;
		}

		const data = await response.json();
		data.latest_release = data.releases[data.releases.length - 1];
		return data;
	} catch (error) {
		console.error(`Error fetching mod info for ${modName}:`, error);
		return null;
	}
}

export async function updateModCache(modId: string, modName: string): Promise<void> {
	try {
		const modInfo = await fetchModInfo(modName);

		if (!modInfo) {
			// Update with fetch error
			await db
				.update(schema.mod)
				.set({
					lastFetched: new Date(),
					fetchError: 'Failed to fetch mod information'
				})
				.where(eq(schema.mod.id, modId));
			return;
		}

		// Update mod with fetched information
		await db
			.update(schema.mod)
			.set({
				title: modInfo.title,
				summary: modInfo.summary,
				description: modInfo.description,
				category: modInfo.category,
				tags: modInfo.tags ? JSON.stringify(modInfo.tags) : null,
				thumbnail: modInfo.thumbnail,
				downloadsCount: modInfo.downloads_count,
				lastUpdated: modInfo.updated_at ? new Date(modInfo.updated_at) : null,
				version: modInfo.latest_release?.version,
				factorioVersion: modInfo.latest_release?.info_json?.factorio_version,
				dependencies: modInfo.latest_release?.info_json?.dependencies
					? JSON.stringify(modInfo.latest_release?.info_json?.dependencies)
					: null,
				lastFetched: new Date(),
				fetchError: null
			})
			.where(eq(schema.mod.id, modId));
	} catch (error) {
		console.error(`Error updating mod cache for ${modName}:`, error);

		// Update with fetch error
		await db
			.update(schema.mod)
			.set({
				lastFetched: new Date(),
				fetchError: error instanceof Error ? error.message : 'Unknown error'
			})
			.where(eq(schema.mod.id, modId));
	}
}

export async function refreshModsCache(modlistId: string): Promise<void> {
	try {
		const mods = await db.select().from(schema.mod).where(eq(schema.mod.modlist, modlistId));

		// Update all mods in parallel
		await Promise.all(mods.map((mod) => updateModCache(mod.id, mod.name)));
	} catch (error) {
		console.error('Error refreshing mods cache:', error);
	}
}

// Helper to check if a user has access (owner or collaborator) to a modlist
export async function userHasModlistAccess(userId: string, modlistId: string): Promise<boolean> {
	const result = await db
		.select({ owner: schema.modList.owner, collaborator: schema.modListCollaborator.userId })
		.from(schema.modList)
		.leftJoin(
			schema.modListCollaborator,
			and(
				eq(schema.modListCollaborator.modlistId, schema.modList.id),
				eq(schema.modListCollaborator.userId, userId)
			)
		)
		.where(eq(schema.modList.id, modlistId))
		.get();

	if (!result) return false;

	return result.owner === userId || result.collaborator === userId;
}
