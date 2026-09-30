import { error } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { genID } from './db/ids';
import {
	type FactoryWatch,
	type FactoryWatchEvent,
	factoryWatch,
	factoryWatchEvent,
	managedServer,
	user
} from './db/schema';
import { factoryQuery } from './factory-query';
import { nextDeficitState, nextResearchState, WATCH_POLL_MS } from './factory-watch-state';
import { ServerError } from './server-files';
import { canManageServer, requireServer } from './servers';

const name = z.string().trim().min(1).max(100);
export const factoryWatchInput = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('research_stalled'), force: name }),
	z.object({ kind: z.literal('item_deficit'), force: name, surface: name, item: name })
]);
export type FactoryWatchInput = z.infer<typeof factoryWatchInput>;

const research = z.object({
	force: z.string(),
	researching: z.boolean(),
	tech: z.string().optional(),
	level: z.number().optional(),
	progress_precise: z.number().min(0).max(1).optional()
});
const rate = z.object({
	found: z.literal(true),
	produced_per_min: z.coerce.number().finite().nonnegative(),
	consumed_per_min: z.coerce.number().finite().nonnegative()
});

export async function listFactoryWatches(userId: string, serverId: string) {
	await requireServer(userId, serverId);
	return db
		.select()
		.from(factoryWatch)
		.where(and(eq(factoryWatch.userId, userId), eq(factoryWatch.serverId, serverId)))
		.orderBy(desc(factoryWatch.createdAt));
}

export async function createFactoryWatch(
	userId: string,
	serverId: string,
	input: FactoryWatchInput
) {
	const server = await requireServer(userId, serverId);
	const parsed = factoryWatchInput.parse(input);
	const existing = await listFactoryWatches(userId, serverId);
	const prior = existing.find(
		(watch) =>
			watch.kind === parsed.kind &&
			watch.force === parsed.force &&
			watch.surface === (parsed.kind === 'item_deficit' ? parsed.surface : null) &&
			watch.item === (parsed.kind === 'item_deficit' ? parsed.item : null)
	);
	if (prior) return prior;
	if (existing.length >= 20) error(429, 'Limit of 20 watches per server');
	const validated = await validateFactoryWatch(server, parsed);
	const watch = {
		id: genID('watch'),
		userId,
		serverId,
		kind: parsed.kind,
		force: parsed.force,
		surface: parsed.kind === 'item_deficit' ? parsed.surface : null,
		item: parsed.kind === 'item_deficit' ? parsed.item : null,
		validated,
		createdAt: new Date()
	};
	const [inserted] = await db.insert(factoryWatch).values(watch).onConflictDoNothing().returning();
	const created =
		inserted ??
		(await listFactoryWatches(userId, serverId)).find(
			(value) =>
				value.kind === parsed.kind &&
				value.force === parsed.force &&
				value.surface === (parsed.kind === 'item_deficit' ? parsed.surface : null) &&
				value.item === (parsed.kind === 'item_deficit' ? parsed.item : null)
		);
	if (!created) error(500, 'Could not save watch');
	return created;
}

async function validateFactoryWatch(
	server: typeof managedServer.$inferSelect,
	input: FactoryWatchInput
) {
	try {
		if (input.kind === 'research_stalled') {
			research.parse(
				await factoryQuery(server, {
					op: 'call',
					tool: 'current_research',
					args: { force: input.force }
				})
			);
		} else {
			const result = await factoryQuery(server, {
				op: 'call',
				tool: 'item_rate',
				args: { force: input.force, surface: input.surface, item: input.item, window: 'one_minute' }
			});
			if (!rate.safeParse(result).success) {
				const reason = z.object({ reason: z.string() }).safeParse(result);
				error(400, reason.success ? reason.data.reason : 'Unknown item or surface');
			}
		}
		return true;
	} catch (cause) {
		if (cause instanceof ServerError && cause.status === 409) return false;
		if (cause instanceof ServerError && cause.status === 400) error(400, cause.message);
		throw cause;
	}
}

export async function setFactoryWatchEnabled(
	userId: string,
	serverId: string,
	watchId: string,
	enabled: boolean
) {
	await requireServer(userId, serverId);
	const [watch] = await db
		.update(factoryWatch)
		.set({
			enabled,
			alerting: false,
			validationError: enabled ? null : undefined,
			lastSampledAt: null,
			lastChangedAt: null,
			lastResearch: null,
			lastProgress: null
		})
		.where(
			and(
				eq(factoryWatch.id, watchId),
				eq(factoryWatch.userId, userId),
				eq(factoryWatch.serverId, serverId)
			)
		)
		.returning();
	if (!watch) error(404, 'Watch not found');
	return watch;
}

export async function removeFactoryWatch(userId: string, serverId: string, watchId: string) {
	await requireServer(userId, serverId);
	const [watch] = await db
		.delete(factoryWatch)
		.where(
			and(
				eq(factoryWatch.id, watchId),
				eq(factoryWatch.userId, userId),
				eq(factoryWatch.serverId, serverId)
			)
		)
		.returning();
	if (!watch) error(404, 'Watch not found');
	return { removed: true };
}

export async function listFactoryAlerts(userId: string) {
	if (!canManageServer(userId)) return [];
	return await db
		.select()
		.from(factoryWatchEvent)
		.where(eq(factoryWatchEvent.userId, userId))
		.orderBy(desc(factoryWatchEvent.createdAt))
		.limit(100);
}

export async function readFactoryAlert(userId: string, eventId: string) {
	if (!canManageServer(userId)) error(403, 'Server management is restricted');
	const [event] = await db
		.update(factoryWatchEvent)
		.set({ readAt: new Date() })
		.where(and(eq(factoryWatchEvent.id, eventId), eq(factoryWatchEvent.userId, userId)))
		.returning();
	if (!event) error(404, 'Alert not found');
	return event;
}

const state = globalThis as typeof globalThis & {
	__facmanduWatchSampler?: ReturnType<typeof setInterval>;
	__facmanduWatchBusy?: boolean;
	__facmanduAlertListeners?: Set<(event: FactoryWatchEvent) => void>;
};
state.__facmanduAlertListeners ??= new Set();
const alertListeners = state.__facmanduAlertListeners;
export function subscribeFactoryAlerts(userId: string, send: (event: FactoryWatchEvent) => void) {
	const listener = (event: FactoryWatchEvent) => {
		if (event.userId === userId && canManageServer(userId)) send(event);
	};
	alertListeners.add(listener);
	return () => alertListeners.delete(listener);
}
export function startFactoryWatchSampler() {
	if (state.__facmanduWatchSampler) return;
	const timer = setInterval(() => {
		void sampleFactoryWatches().catch((cause) =>
			console.error('Factory watch sampling failed:', cause)
		);
	}, WATCH_POLL_MS);
	timer.unref();
	state.__facmanduWatchSampler = timer;
	void sampleFactoryWatches().catch((cause) =>
		console.error('Factory watch sampling failed:', cause)
	);
}
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		if (state.__facmanduWatchSampler) clearInterval(state.__facmanduWatchSampler);
		state.__facmanduWatchSampler = undefined;
	});

export async function sampleFactoryWatches() {
	if (state.__facmanduWatchBusy) return;
	state.__facmanduWatchBusy = true;
	try {
		const watches = await db
			.select({ watch: factoryWatch, server: managedServer, owner: user.id })
			.from(factoryWatch)
			.innerJoin(managedServer, eq(factoryWatch.serverId, managedServer.id))
			.innerJoin(user, eq(factoryWatch.userId, user.id))
			.where(eq(factoryWatch.enabled, true));
		for (const { watch, server, owner } of watches) {
			if (!canManageServer(owner)) continue; // Recheck operator authorization on every execution.
			try {
				await sampleWatch(watch, server);
			} catch (cause) {
				if (cause instanceof ServerError && cause.status === 400) {
					await db
						.update(factoryWatch)
						.set({ enabled: false, validated: false, validationError: cause.message })
						.where(and(eq(factoryWatch.id, watch.id), eq(factoryWatch.enabled, true)));
				} else if (
					cause instanceof ServerError &&
					cause.status === 409 &&
					watch.kind === 'research_stalled'
				) {
					// A stopped server cannot supply evidence of stalled research.
					await saveObservation(
						watch,
						{
							lastSampledAt: null,
							lastChangedAt: null,
							lastResearch: null,
							lastProgress: null,
							alerting: false
						},
						null
					);
				} else if (!(cause instanceof ServerError && cause.status === 409))
					console.warn(
						`Factory watch ${watch.id} skipped:`,
						cause instanceof Error ? cause.message : cause
					);
			}
		}
	} finally {
		state.__facmanduWatchBusy = false;
	}
}

async function sampleWatch(watch: FactoryWatch, server: typeof managedServer.$inferSelect) {
	const now = new Date();
	if (watch.kind === 'research_stalled') {
		const value = research.parse(
			await factoryQuery(server, {
				op: 'call',
				tool: 'current_research',
				args: { force: watch.force }
			})
		);
		if (!value.researching || !value.tech || value.progress_precise === undefined) {
			const { notify: _, ...update } = nextResearchState(watch, null, null, now);
			await saveObservation(watch, { ...update, validated: true, validationError: null }, null);
			return;
		}
		const subject = `${value.tech}:${value.level ?? 1}`;
		const progress = Math.round(value.progress_precise * 1_000_000);
		const { notify, ...update } = nextResearchState(watch, subject, progress, now);
		await saveObservation(
			watch,
			{ ...update, validated: true, validationError: null },
			notify
				? `${watch.force} research stalled: ${value.tech} has made no progress for 5 minutes.`
				: null
		);
		return;
	}
	if (!watch.surface || !watch.item) return;
	const result = await factoryQuery(server, {
		op: 'call',
		tool: 'item_rate',
		args: { force: watch.force, surface: watch.surface, item: watch.item, window: 'one_minute' }
	});
	const parsed = rate.safeParse(result);
	if (!parsed.success) {
		const reason = z.object({ reason: z.string() }).safeParse(result);
		throw new ServerError(400, reason.success ? reason.data.reason : 'Unknown item or surface');
	}
	const { produced_per_min: produced, consumed_per_min: consumed } = parsed.data;
	const { alerting, notify } = nextDeficitState(produced, consumed, watch.alerting);
	await saveObservation(
		watch,
		{ lastSampledAt: now, alerting, validated: true, validationError: null },
		notify
			? `${watch.item} consumption exceeds production on ${watch.surface} (${watch.force}): ${consumed}/min used, ${produced}/min made.`
			: null
	);
}

async function saveObservation(
	watch: FactoryWatch,
	update: Partial<FactoryWatch>,
	message: string | null
) {
	// The old sample timestamp is a compare-and-swap guard against overlapping app processes.
	const event = await db.transaction(async (tx) => {
		const claim = await tx
			.update(factoryWatch)
			.set(update)
			.where(
				and(
					eq(factoryWatch.id, watch.id),
					eq(factoryWatch.enabled, true),
					watch.lastSampledAt
						? eq(factoryWatch.lastSampledAt, watch.lastSampledAt)
						: isNull(factoryWatch.lastSampledAt)
				)
			)
			.returning({ id: factoryWatch.id });
		if (!claim.length || !message) return;
		const [created] = await tx
			.insert(factoryWatchEvent)
			.values({
				id: genID('alert'),
				watchId: watch.id,
				userId: watch.userId,
				serverId: watch.serverId,
				message,
				createdAt: new Date()
			})
			.returning();
		return created;
	});
	if (event) for (const listener of alertListeners) listener(event);
}
