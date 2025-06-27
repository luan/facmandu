import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq, and } from 'drizzle-orm';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import { factorioApiLimiter } from '$lib/server/rate-limiter';

const connectionUrl = env.TURSO_CONNECTION_URL || env.DATABASE_URL;
if (!connectionUrl) throw new Error('TURSO_CONNECTION_URL or DATABASE_URL must be set');

const clientConfig: Parameters<typeof createClient>[0] = { url: connectionUrl };
if (env.TURSO_AUTH_TOKEN) {
	clientConfig.authToken = env.TURSO_AUTH_TOKEN;
}

// Configure connection pooling for better performance under load
const client = createClient({
	...clientConfig,
	// Enable connection pooling
	syncUrl: clientConfig.url,
	// Pool configuration
	connectionTimeout: 30000, // 30 seconds
	requestTimeout: 15000 // 15 seconds per request
});

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

export async function fetchModInfo(
	modName: string,
	retryCount = 0
): Promise<FactorioModInfo | null> {
	const maxRetries = 2;
	const timeoutMs = 30000; // Increased to 30 seconds

	try {
		const url = `https://mods.factorio.com/api/mods/${modName}/full`;
		const response = await factorioApiLimiter.fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
			headers: {
				'User-Agent': 'FactorioManager/1.0'
			}
		});

		if (!response.ok) {
			if (response.status === 429 && retryCount < maxRetries) {
				// Rate limited, wait and retry
				const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
				console.warn(
					`Rate limited for ${modName}, retrying in ${delay}ms (attempt ${retryCount + 1})`
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
				return fetchModInfo(modName, retryCount + 1);
			}
			console.error(`Failed to fetch mod info for ${modName}:`, response.status);
			return null;
		}

		const data = await response.json();
		data.latest_release = data.releases[data.releases.length - 1];
		return data;
	} catch (error) {
		if (error instanceof Error && error.name === 'TimeoutError' && retryCount < maxRetries) {
			// Timeout, wait and retry with exponential backoff
			const delay = Math.pow(2, retryCount) * 2000; // 2s, 4s, 8s for timeouts
			console.warn(`Timeout for ${modName}, retrying in ${delay}ms (attempt ${retryCount + 1})`);
			await new Promise((resolve) => setTimeout(resolve, delay));
			return fetchModInfo(modName, retryCount + 1);
		}
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

		// Process mods in smaller batches to avoid overwhelming the API
		const batchSize = 3;
		for (let i = 0; i < mods.length; i += batchSize) {
			const batch = mods.slice(i, i + batchSize);
			await Promise.all(batch.map((mod) => updateModCache(mod.id, mod.name)));

			// Small delay between batches to be gentler on the API
			if (i + batchSize < mods.length) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}
	} catch (error) {
		console.error('Error refreshing mods cache:', error);
	}
}

// Helper to check if a user has access (owner or collaborator) to a modlist
export async function userHasModlistAccess(userId: string, modlistId: string): Promise<boolean> {
	// First check if user is the owner (most common case, fastest query)
	const modlist = await db
		.select({ owner: schema.modList.owner })
		.from(schema.modList)
		.where(eq(schema.modList.id, modlistId))
		.get();

	if (!modlist) return false;
	if (modlist.owner === userId) return true;

	// Only check collaborators if user is not the owner
	const collaboration = await db
		.select({ userId: schema.modListCollaborator.userId })
		.from(schema.modListCollaborator)
		.where(
			and(
				eq(schema.modListCollaborator.modlistId, modlistId),
				eq(schema.modListCollaborator.userId, userId)
			)
		)
		.get();

	return !!collaboration;
}
