import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { recommendationFeedback } from './db/schema';

// Callers authorize the actor and validate mod names before saving preferences.
export async function saveRecommendationFeedback(
	userId: string,
	listId: string,
	names: string[],
	dismissed: boolean
) {
	const unique = [...new Set(names)];
	if (dismissed)
		await db
			.insert(recommendationFeedback)
			.values(unique.map((modName) => ({ userId, listId, modName })))
			.onConflictDoNothing();
	else
		await db
			.delete(recommendationFeedback)
			.where(
				and(
					eq(recommendationFeedback.userId, userId),
					eq(recommendationFeedback.listId, listId),
					inArray(recommendationFeedback.modName, unique)
				)
			);
	return { names: unique, dismissed };
}
