import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { json } from '@sveltejs/kit';
import { userHasModlistAccess } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async (event) => {
	// Verify user session
	if (!event.locals.session) {
		return json({ message: 'unauthorized' }, { status: 401 });
	}

	const modlistId = event.params.id;
	if (!modlistId) {
		return json({ message: 'modlist id required' }, { status: 400 });
	}

	// Verify user access
	const hasAccess = await userHasModlistAccess(event.locals.session.userId, modlistId);
	if (!hasAccess) {
		return json({ message: 'Access denied' }, { status: 403 });
	}

	// Retrieve user factorio credentials
	const user = await db
		.select({
			factorioUsername: table.user.factorioUsername,
			factorioToken: table.user.factorioToken
		})
		.from(table.user)
		.where(eq(table.user.id, event.locals.session.userId))
		.get();

	if (!user?.factorioUsername || !user?.factorioToken) {
		return json({ message: 'missing credentials' }, { status: 400 });
	}

	// Extract search params
	const searchQuery = event.url.searchParams.get('q')?.trim() || '';
	if (!searchQuery) {
		return json({ results: [], currentPage: 1, totalPages: 1 });
	}

	const categoryFilter = event.url.searchParams.get('category');
	const versionFilter = event.url.searchParams.get('version');
	const tagFilters = event.url.searchParams.getAll('tag');
	const sortAttrParam = event.url.searchParams.get('sort_attr');

	let currentPage = parseInt(event.url.searchParams.get('page') ?? '1', 10);
	if (Number.isNaN(currentPage) || currentPage < 1) currentPage = 1;
	const pageSize = parseInt(event.url.searchParams.get('page_size') ?? '30', 10);
	const effectivePageSize = Number.isNaN(pageSize) || pageSize < 1 ? 30 : pageSize;

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
		query: searchQuery,
		username: user.factorioUsername,
		token: user.factorioToken,
		show_deprecated: false,
		sort_attribute: sortAttribute,
		exclude_category: ['internal'],
		page: currentPage,
		page_size: effectivePageSize
	};

	if (categoryFilter) requestBody.category = categoryFilter;
	if (versionFilter && versionFilter !== 'any') requestBody.factorio_version = versionFilter;
	if (tagFilters.length > 0) requestBody.tag = tagFilters;

	try {
		const resp = await fetch('https://mods.factorio.com/api/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requestBody)
		});
		if (!resp.ok) {
			return json({ message: 'Factorio API error' }, { status: 502 });
		}
		const data = await resp.json();
		const results = data.results || [];
		let totalPages = 1;
		if (typeof data.page_count === 'number') {
			totalPages = data.page_count;
		} else if (typeof data.result_count === 'number' && typeof data.page_size === 'number') {
			totalPages = Math.max(1, Math.ceil(data.result_count / data.page_size));
		}

		return json({ results, currentPage, totalPages });
	} catch (err) {
		return json({ message: 'search failed' }, { status: 500 });
	}
};
