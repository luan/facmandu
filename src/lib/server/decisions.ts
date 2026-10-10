import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { DecisionRequest } from '$lib/decisions';
import { cachedPortalRequest } from './portal-cache';

export function cachedDecisionRequest<T extends z.ZodType>(
	accountId: string,
	apiKey: string,
	body: DecisionRequest,
	schema: T
) {
	const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
	return cachedPortalRequest(
		`decisions:${accountId}:${hash}`,
		'https://api.openai.com/v1/decisions',
		schema,
		{ maxAgeMs: Infinity },
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		},
		// Decisions must not wait behind the Factorio portal's request queue.
		fetch
	);
}
