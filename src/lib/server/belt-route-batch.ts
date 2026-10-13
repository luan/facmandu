import type * as v from 'valibot';
import type { beltRouteInput, beltRoutesInput, designBeltRoute } from './factory-routing';
import { ServerError } from './server-files';

// Route in order: each saved path becomes an obstacle for the following connection.
// Failed connections retain their own result without losing earlier saved drafts.
export async function designBeltRoutes(
	input: v.InferOutput<typeof beltRoutesInput>,
	route: (input: v.InferOutput<typeof beltRouteInput>) => ReturnType<typeof designBeltRoute>
) {
	const { connections, ...shared } = input;
	const avoid = [...(input.avoid ?? [])];
	const results: ({ connection: number; label?: string } & (
		| Awaited<ReturnType<typeof designBeltRoute>>
		| { found: false; error: string; placed: false }
	))[] = [];
	for (const [index, connection] of connections.entries()) {
		try {
			const result = await route({ ...shared, ...connection, avoid: [...avoid] });
			results.push({ connection: index + 1, label: connection.label, ...result });
			if ('draft' in result && result.draft.designId)
				avoid.push({ designId: result.draft.designId, position: result.position });
		} catch (cause) {
			// Scope/connection failures stop further native reads; recoverable path faults
			// leave independent connections available in the same bounded batch.
			if (!(cause instanceof ServerError) || cause.status !== 400) throw cause;
			results.push({
				connection: index + 1,
				label: connection.label,
				found: false,
				error: cause.message,
				placed: false
			});
		}
	}
	return results;
}
