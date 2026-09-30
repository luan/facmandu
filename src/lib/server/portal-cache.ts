import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { supportsFactorio } from '$lib/dependencies';
import { db } from '$lib/server/db';
import { portalCache } from '$lib/server/db/schema';
import { factorioApiLimiter } from '$lib/server/rate-limiter';

export class PortalHttpError extends Error {
	constructor(readonly status: number) {
		super(`Mod portal returned HTTP ${status}`);
		this.name = 'PortalHttpError';
	}
}
const pending = new Map<string, Promise<CacheResult<unknown>>>();
type CacheEntry = typeof portalCache.$inferSelect;
const unpersisted = new Map<string, { entry: CacheEntry; retryAt: number }>();

async function saveCache(entry: CacheEntry) {
	const retained = { entry, retryAt: Number.POSITIVE_INFINITY };
	unpersisted.delete(entry.key);
	unpersisted.set(entry.key, retained);
	// Bound temporary outage storage; the database remains the durable cache for all entries.
	if (unpersisted.size > 128) {
		const oldest = unpersisted.keys().next().value;
		if (oldest) unpersisted.delete(oldest);
	}
	try {
		await db
			.insert(portalCache)
			.values(entry)
			.onConflictDoUpdate({ target: portalCache.key, set: entry });
		if (unpersisted.get(entry.key) === retained) unpersisted.delete(entry.key);
	} catch {
		retained.retryAt = Date.now() + 60_000;
		console.warn('Cache persistence unavailable; retaining the result for retry');
	}
}

async function readCache(key: string): Promise<CacheEntry | undefined> {
	const retained = unpersisted.get(key);
	if (!retained) return await db.select().from(portalCache).where(eq(portalCache.key, key)).get();
	if (retained.retryAt <= Date.now()) void saveCache(retained.entry);
	return retained.entry;
}

export type CacheResult<T> = {
	data: T | null;
	source: 'cache' | 'network';
	fetchedAt: number;
	warning?: string;
};
export type CacheOptions = { maxAgeMs: number; refresh?: boolean };

export async function cachedPortalRequest<T extends z.ZodType>(
	key: string,
	url: string,
	schema: T,
	options: CacheOptions,
	init: RequestInit = {}
): Promise<CacheResult<z.infer<T>>> {
	const now = Date.now();
	const cached = await readCache(key);
	let parsed: z.ZodSafeParseResult<z.infer<T>> | null = null;
	try {
		if (cached?.body) parsed = schema.safeParse(JSON.parse(cached.body));
	} catch {
		/* A damaged cache entry is replaced by the next successful request. */
	}
	const data = parsed?.success ? parsed.data : null;
	if (
		cached &&
		!options.refresh &&
		(cached.retryAfter > now || (data && now - cached.fetchedAt < options.maxAgeMs))
	) {
		if (!data && cached.status !== 404) throw new PortalHttpError(cached.status);
		return {
			data,
			source: 'cache',
			fetchedAt: cached.fetchedAt,
			...(cached.status !== 200 && cached.status !== 404
				? { warning: 'Using cached metadata while the mod portal is unavailable' }
				: {})
		};
	}
	let request = pending.get(key);
	if (!request) {
		request = (async (): Promise<CacheResult<unknown>> => {
			const headers = new Headers(init.headers);
			headers.set('User-Agent', 'Facmandu/1.0');
			if (cached?.etag && data) headers.set('If-None-Match', cached.etag);
			if (cached?.lastModified && data) headers.set('If-Modified-Since', cached.lastModified);
			try {
				const response = await factorioApiLimiter.fetch(url, {
					...init,
					headers,
					signal: AbortSignal.timeout(15_000)
				});
				if (response.status === 304 && data && cached) {
					await saveCache({ ...cached, fetchedAt: now, retryAfter: 0, status: 200 });
					return { data, source: 'network', fetchedAt: now };
				}
				if (!response.ok && response.status !== 404) throw new PortalHttpError(response.status);
				const value = response.status === 404 ? null : schema.parse(await response.json());
				const entry = {
					key,
					body: value === null ? null : JSON.stringify(value),
					status: response.status,
					fetchedAt: now,
					retryAfter: value === null ? now + 15 * 60_000 : 0,
					etag: response.headers.get('etag'),
					lastModified: response.headers.get('last-modified')
				};
				await saveCache(entry);
				return { data: value, source: 'network', fetchedAt: now };
			} catch (cause) {
				const entry = {
					key,
					body: data ? JSON.stringify(data) : null,
					status: cause instanceof PortalHttpError ? cause.status : 503,
					fetchedAt: cached?.fetchedAt ?? now,
					retryAfter: now + 60_000,
					etag: cached?.etag ?? null,
					lastModified: cached?.lastModified ?? null
				};
				await saveCache(entry);
				if (data)
					return {
						data,
						source: 'cache',
						fetchedAt: cached?.fetchedAt ?? now,
						warning: 'Using cached metadata while the mod portal is unavailable'
					};
				throw cause;
			}
		})().finally(() => {
			pending.delete(key);
		});
		pending.set(key, request);
	}
	const result = await request;
	return { ...result, data: result.data === null ? null : schema.parse(result.data) };
}

export const releaseSchema = z.object({
	version: z.string(),
	download_url: z.string().optional(),
	file_name: z.string().optional(),
	sha1: z.string().optional(),
	released_at: z.string().optional(),
	info_json: z.object({
		factorio_version: z.string().default('0.12'),
		dependencies: z.array(z.string()).default(['base'])
	})
});
export const portalModSchema = z.object({
	name: z.string(),
	title: z.string(),
	owner: z.string().optional(),
	summary: z.string().nullish(),
	description: z.string().nullish(),
	category: z.string().nullish(),
	tags: z.array(z.string()).nullish(),
	thumbnail: z.string().nullish(),
	downloads_count: z.number().nullish(),
	updated_at: z.string().nullish(),
	releases: z.array(releaseSchema)
});
export type PortalMod = z.infer<typeof portalModSchema>;
export type PortalRelease = z.infer<typeof releaseSchema>;

export function getPortalMod(name: string, refresh = false) {
	return cachedPortalRequest(
		`mod:${name}`,
		`https://mods.factorio.com/api/mods/${encodeURIComponent(name)}/full`,
		portalModSchema,
		{ maxAgeMs: 15 * 60_000, refresh }
	);
}

export async function getPortalModForFactorio(name: string, factorioVersion: string) {
	let result = await getPortalMod(name);
	const compatible = (data: PortalMod | null) =>
		data?.releases.some((release) =>
			supportsFactorio(release.info_json.factorio_version, factorioVersion)
		) ?? false;
	// A cached catalog cannot establish that no release exists for a newer game version.
	if (result.source === 'cache' && !compatible(result.data))
		result = await getPortalMod(name, true);
	if (result.source === 'cache' && !compatible(result.data))
		throw new Error('Could not verify compatible releases while the Mod Portal is unavailable');
	return result;
}
