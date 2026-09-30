import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
	composeRanking,
	type RecommendationRating,
	rankingAnswerSchema,
	rankingQuestions,
	rankingState
} from '$lib/recommendation-ranking';
import {
	type RecommendationCandidate,
	type RecommendationMod,
	recommendationCandidates,
	recommendationPageSize,
	recommendationPriority,
	recommendationRelease
} from '$lib/recommendations';
import { listOwnerKey } from './accounts';
import { db, userHasModlistAccess } from './db';
import { mod, modList, portalCache, recommendationFeedback } from './db/schema';
import {
	cachedPortalRequest,
	getPortalMod,
	getPortalModForFactorio,
	PortalHttpError,
	portalModSchema
} from './portal-cache';

export class RecommendationRankingError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'RecommendationRankingError';
	}
}

async function compatibleCandidate(
	candidate: RecommendationCandidate,
	mods: RecommendationMod[],
	factorioVersion: string
) {
	let result = await getPortalModForFactorio(candidate.name, factorioVersion);
	let release =
		result.data && recommendationRelease(result.data.releases, candidate, mods, factorioVersion);
	if (!release && result.source === 'cache') {
		result = await getPortalMod(candidate.name, true);
		release =
			result.data && recommendationRelease(result.data.releases, candidate, mods, factorioVersion);
	}
	if (result.warning)
		throw new RecommendationRankingError(503, 'Current mod metadata could not be verified');
	return result.data && release ? { data: result.data, release } : null;
}

export async function rankModlistRecommendations(
	userId: string,
	listId: string,
	names: string[],
	dismissed: string[]
): Promise<{
	scores: Record<string, RecommendationRating>;
	source: 'cache' | 'network';
	warning?: string;
}> {
	if (!(await userHasModlistAccess(userId, listId)))
		throw new RecommendationRankingError(403, 'You cannot edit this list');
	const owner = await listOwnerKey(listId);
	const apiKey = owner?.apiKey;
	if (!apiKey)
		throw new RecommendationRankingError(
			503,
			'The list owner needs to add a TypeSafe key in account settings'
		);
	if (
		names.length < 1 ||
		names.length > 20 ||
		names.some((name) => name.length > 100) ||
		dismissed.length > 40 ||
		dismissed.some((name) => name.length < 1 || name.length > 100)
	)
		throw new RecommendationRankingError(400, 'Select up to 20 recommendations');
	const [list, mods, feedback] = await Promise.all([
		db
			.select({ factorioVersion: modList.factorioVersion })
			.from(modList)
			.where(eq(modList.id, listId))
			.get(),
		db
			.select({
				name: mod.name,
				title: mod.title,
				summary: mod.summary,
				description: mod.description,
				category: mod.category,
				enabled: mod.enabled,
				dependencies: mod.dependencies
			})
			.from(mod)
			.where(and(eq(mod.modlist, listId), or(isNull(mod.icebox), eq(mod.icebox, false)))),
		db
			.select({ name: recommendationFeedback.modName })
			.from(recommendationFeedback)
			.where(
				and(eq(recommendationFeedback.userId, userId), eq(recommendationFeedback.listId, listId))
			)
	]);
	if (!list) throw new RecommendationRankingError(404, 'List not found');
	const dismissedNames = new Set(
		feedback
			.map((row) => row.name)
			.filter((name) => !mods.some((item) => item.name === name && item.enabled))
	);
	const selected = new Set(names.filter((name) => !dismissedNames.has(name)));
	const candidates = recommendationCandidates(mods)
		.filter((candidate) => selected.has(candidate.name))
		.sort((a, b) => a.name.localeCompare(b.name));
	const details = await Promise.all(
		candidates.map(async (candidate) => {
			const compatible = await compatibleCandidate(candidate, mods, list.factorioVersion);
			return compatible
				? {
						name: compatible.data.name,
						title: compatible.data.title,
						summary: compatible.data.summary,
						description: compatible.data.description?.slice(0, 4000),
						category: compatible.data.category,
						tags: compatible.data.tags,
						dependencies: compatible.release.info_json.dependencies,
						version: compatible.release.version,
						recommendedBy: candidate.recommendedBy
					}
				: null;
		})
	);
	const shortlist = details.filter((detail) => detail !== null);
	if (!shortlist.length) return { scores: {}, source: 'cache' };
	const contextDismissals = [...dismissedNames].sort().slice(-40);
	const cachedDismissals = contextDismissals.length
		? await db
				.select({ key: portalCache.key, body: portalCache.body })
				.from(portalCache)
				.where(
					inArray(
						portalCache.key,
						contextDismissals.map((name) => `mod:${name}`)
					)
				)
		: [];
	const dismissedMods = cachedDismissals
		.flatMap((entry) => {
			try {
				const parsed = portalModSchema.safeParse(JSON.parse(entry.body ?? 'null'));
				if (!parsed.success || entry.key !== `mod:${parsed.data.name}`) return [];
				const { name, title, summary, description, category } = parsed.data;
				return [{ name, title, summary, category, description: description?.slice(0, 1000) }];
			} catch {
				return [];
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	// Keep list and account identities local; TypeSafe receives public mod metadata only.
	const related = new Set(shortlist.flatMap((candidate) => candidate.recommendedBy));
	const enabledMods = mods
		.filter((item) => item.enabled)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(({ name, title, summary, description, category }) => ({
			name,
			title,
			summary,
			category,
			description:
				related.has(name) || category === 'overhaul' ? description?.slice(0, 1500) : undefined
		}));
	const questions = rankingQuestions(shortlist);
	for (const maxBytes of [60_000, 28_000]) {
		try {
			const state = rankingState(
				list.factorioVersion,
				enabledMods,
				shortlist,
				maxBytes,
				dismissedMods
			);
			const body = { model: 'jev-latest', state, questions };
			const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
			const result = await cachedPortalRequest(
				`typesafe:${owner.ownerId}:${hash}`,
				'https://api.typesafe.ai/v1/systemone',
				rankingAnswerSchema.refine(
					(value) => shortlist.every((_, index) => composeRanking(value.answers, index) !== null),
					'Incomplete rankings'
				),
				{ maxAgeMs: Number.POSITIVE_INFINITY },
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(body)
				}
			);
			if (!result.data) throw new RecommendationRankingError(502, 'TypeSafe returned no rankings');
			const scores = Object.fromEntries(
				shortlist.flatMap((candidate, index) => {
					const answer = result.data && composeRanking(result.data.answers, index);
					return answer ? [[candidate.name, answer]] : [];
				})
			);
			return { scores, source: result.source, warning: result.warning };
		} catch (cause) {
			if (maxBytes === 60_000 && cause instanceof PortalHttpError && cause.status === 400) continue;
			console.warn(
				'Recommendation ranking failed',
				cause instanceof PortalHttpError
					? cause.status
					: cause instanceof Error
						? cause.name
						: 'Unknown error'
			);
			break;
		}
	}
	throw new RecommendationRankingError(
		502,
		'Ranking is unavailable. You can still browse and add mods.'
	);
}

export async function listRankedRecommendations(
	userId: string,
	listId: string,
	limit = recommendationPageSize,
	offset = 0
) {
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 20 ||
		!Number.isSafeInteger(offset) ||
		offset < 0
	)
		throw new RecommendationRankingError(400, 'Choose 1–20 recommendations');
	if (!(await userHasModlistAccess(userId, listId)))
		throw new RecommendationRankingError(403, 'You cannot edit this list');
	const [list, mods, feedback] = await Promise.all([
		db
			.select({ factorioVersion: modList.factorioVersion })
			.from(modList)
			.where(eq(modList.id, listId))
			.get(),
		db
			.select({ name: mod.name, enabled: mod.enabled, dependencies: mod.dependencies })
			.from(mod)
			.where(and(eq(mod.modlist, listId), or(isNull(mod.icebox), eq(mod.icebox, false)))),
		db
			.select({ name: recommendationFeedback.modName })
			.from(recommendationFeedback)
			.where(
				and(eq(recommendationFeedback.userId, userId), eq(recommendationFeedback.listId, listId))
			)
	]);
	if (!list) throw new RecommendationRankingError(404, 'List not found');
	const dismissed = feedback.map((row) => row.name).sort();
	const excluded = new Set(dismissed);
	const pool = recommendationCandidates(mods).filter((candidate) => !excluded.has(candidate.name));
	const candidates: (typeof pool)[number][] = [];
	let cursor = offset;
	const scanEnd = Math.min(pool.length, offset + limit);
	while (cursor < scanEnd) {
		const batch = pool.slice(cursor, Math.min(scanEnd, cursor + 4));
		const compatible = await Promise.all(
			batch.map(async (candidate) => {
				return (await compatibleCandidate(candidate, mods, list.factorioVersion))
					? candidate
					: null;
			})
		);
		candidates.push(...compatible.filter((candidate) => candidate !== null));
		cursor += batch.length;
	}
	const nextOffset = cursor < pool.length ? cursor : null;
	if (!candidates.length)
		return {
			candidates: [],
			dismissed,
			scores: {},
			source: 'cache' as const,
			totalCandidates: pool.length,
			nextOffset
		};
	const ranked = await rankModlistRecommendations(
		userId,
		listId,
		candidates.map((candidate) => candidate.name),
		[]
	);
	return {
		...ranked,
		dismissed,
		totalCandidates: pool.length,
		nextOffset,
		candidates: candidates
			.flatMap((candidate) => {
				const rating = ranked.scores[candidate.name];
				return rating
					? [{ name: candidate.name, recommendedBy: candidate.recommendedBy, rating }]
					: [];
			})
			.sort(
				(a, b) =>
					recommendationPriority(b.rating) - recommendationPriority(a.rating) ||
					a.name.localeCompare(b.name)
			)
	};
}
