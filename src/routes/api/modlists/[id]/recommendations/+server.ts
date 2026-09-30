import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireSameOrigin } from '$lib/server/auth';
import { db, userHasModlistAccess } from '$lib/server/db';
import { recommendationFeedback } from '$lib/server/db/schema';
import { validModName } from '$lib/server/mod-names';
import {
	RecommendationRankingError,
	rankModlistRecommendations
} from '$lib/server/modlist-recommendations';
import { saveRecommendationFeedback } from '$lib/server/recommendation-feedback';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in');
	if (!(await userHasModlistAccess(locals.user.id, params.id)))
		error(403, 'You cannot edit this list');
	const rows = await db
		.select({ name: recommendationFeedback.modName })
		.from(recommendationFeedback)
		.where(
			and(
				eq(recommendationFeedback.userId, locals.user.id),
				eq(recommendationFeedback.listId, params.id)
			)
		);
	return json(
		{ dismissed: rows.map((row) => row.name) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	requireSameOrigin(request, url);
	if (!locals.user) error(401, 'Sign in');
	if (!(await userHasModlistAccess(locals.user.id, params.id)))
		error(403, 'You cannot edit this list');
	const parsed = z
		.object({
			names: z.array(z.string().refine(validModName)).min(1).max(1000),
			dismissed: z.boolean()
		})
		.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid recommendation feedback');
	await saveRecommendationFeedback(
		locals.user.id,
		params.id,
		parsed.data.names,
		parsed.data.dismissed
	);
	return json({ saved: true });
};

const input = z.object({
	names: z.array(z.string().max(100)).min(1).max(20),
	dismissed: z.array(z.string().min(1).max(100)).max(40).default([])
});
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Sign in');
	if (!(await userHasModlistAccess(locals.user.id, params.id)))
		error(403, 'You cannot edit this list');
	const parsed = input.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Select up to 20 recommendations');
	try {
		return json(
			await rankModlistRecommendations(
				locals.user.id,
				params.id,
				parsed.data.names,
				parsed.data.dismissed
			)
		);
	} catch (cause) {
		if (cause instanceof RecommendationRankingError) {
			if (cause.status === 502) return json({ message: cause.message }, { status: 502 });
			error(cause.status, cause.message);
		}
		throw cause;
	}
};
