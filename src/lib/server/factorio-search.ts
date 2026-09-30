import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cachedPortalRequest } from '$lib/server/portal-cache';

const optionalString = z
	.string()
	.nullish()
	.transform((value) => value ?? undefined);
const resultSchema = z.object({
	name: z.string(),
	title: z.string(),
	owner: z.string(),
	summary: optionalString,
	description: optionalString,
	category: optionalString,
	thumbnail: optionalString,
	updated_at: optionalString,
	created_at: optionalString,
	downloads_count: z
		.number()
		.nullish()
		.transform((value) => value ?? undefined),
	tags: z
		.array(z.string())
		.nullish()
		.transform((value) => value ?? undefined),
	// Search returns a release ID, unlike /api/mods. The display version has its own field.
	latest_release_version: optionalString,
	factorio_versions: z
		.array(z.string())
		.nullish()
		.transform((value) => value ?? [])
});

const responseSchema = z.object({
	results: z.array(resultSchema),
	pagination: z
		.object({ page: z.number(), page_count: z.number(), page_size: z.number(), count: z.number() })
		.optional(),
	page_count: z.number().optional(),
	result_count: z.number().optional(),
	page_size: z.number().optional()
});

export type FactorioSearchResult = z.infer<typeof resultSchema>;
export type FactorioCredentials = { username: string; token: string };

const sortAttributes = ['relevancy', 'most_downloads', 'last_updated_at', 'trending'] as const;
type SortAttribute = (typeof sortAttributes)[number];

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function factorioSearchOptions(params: URLSearchParams) {
	const requestedSort = params.get('sort_attr');
	const sortAttribute: SortAttribute =
		sortAttributes.find((value) => value === requestedSort) ?? 'relevancy';
	return {
		query: params.get('q')?.trim().slice(0, 200) ?? '',
		category: params.get('category') ?? '',
		version: params.get('version') ?? 'any',
		tags: [...new Set(params.getAll('tag'))].sort(),
		sortAttribute,
		page: positiveInteger(params.get('page'), 1, 10_000),
		pageSize: positiveInteger(params.get('page_size'), 30, 100)
	};
}

export async function searchFactorioMods(
	params: URLSearchParams,
	credentials?: FactorioCredentials
) {
	const options = factorioSearchOptions(params);
	if (!options.query)
		return {
			results: [] as FactorioSearchResult[],
			currentPage: 1,
			totalPages: 1,
			warning: undefined
		};
	const body: Record<string, unknown> = {
		query: options.query,
		show_deprecated: false,
		sort_attribute: options.sortAttribute,
		page: options.page,
		page_size: options.pageSize
	};
	if (credentials) {
		body.username = credentials.username;
		body.token = credentials.token;
	}
	if (options.category) body.category = [options.category];
	else body.exclude_category = ['internal'];
	if (options.version !== 'any') body.version = `${options.version}.0`;
	if (options.tags.length) body.tag = options.tags;

	// A rejected account must not put other users' searches into the failure cooldown.
	const cacheKey = createHash('sha256')
		.update(JSON.stringify({ options, credentials }))
		.digest('hex');
	const result = await cachedPortalRequest(
		`search:${cacheKey}`,
		'https://mods.factorio.com/api/search',
		responseSchema,
		{ maxAgeMs: 15 * 60_000 },
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
	);
	if (!result.data) throw new Error('Search unavailable');
	const data = result.data;
	const totalPages =
		data.pagination?.page_count ??
		data.page_count ??
		(data.result_count !== undefined && data.page_size
			? Math.max(1, Math.ceil(data.result_count / data.page_size))
			: data.results.length === options.pageSize
				? options.page + 1
				: options.page);
	return { results: data.results, currentPage: options.page, totalPages, warning: result.warning };
}
