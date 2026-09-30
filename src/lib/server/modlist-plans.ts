import { createHash } from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	compareVersions,
	inspectDependencies,
	isBundledMod,
	supportsFactorio
} from '$lib/dependencies';
import { type ReleaseCatalog, resolveModList } from '$lib/mod-resolution';
import { db, userHasModlistAccess } from './db';
import { genID } from './db/ids';
import { type Mod, mod, modList, modListCollaborator, modlistPlan } from './db/schema';
import { modMetadataValues } from './mod-metadata';
import { validModName } from './mod-names';
import { getPortalMod } from './portal-cache';
import { publishModlistEvent } from './realtime';

export const changeSchema = z
	.object({
		name: z.string().refine(validModName),
		action: z.enum(['enable', 'disable', 'remove', 'icebox', 'lock', 'unlock', 'set_version']),
		version: z.string().optional()
	})
	.superRefine((change, context) => {
		if (
			change.action === 'set_version' &&
			(!change.version || compareVersions(change.version, change.version) === null)
		)
			context.addIssue({
				code: 'custom',
				message: 'Choose a valid mod release',
				path: ['version']
			});
	})
	.transform((change) => {
		// A version attached to any other action is meaningless. Drop it instead of
		// failing: the assistant echoes the installed release when removing mods.
		if (change.action !== 'set_version' && change.version !== undefined)
			return { ...change, version: undefined };
		return change;
	});
export const planInputSchema = z.object({ changes: z.array(changeSchema).min(1).max(40) });
export type RequestedModChange = z.infer<typeof changeSchema>;
export type ModlistPlanDetail = {
	name: string;
	title: string;
	action: 'add' | 'remove' | 'enable' | 'disable' | 'icebox' | 'update' | 'lock' | 'unlock';
	version: string | null;
	dependency: boolean;
	requiredBy?: string[];
};
export const modlistSnapshot = (name: string, version: string, mods: Mod[]) =>
	createHash('sha256')
		.update(JSON.stringify([name, version, mods.toSorted((a, b) => a.name.localeCompare(b.name))]))
		.digest('hex');
export async function authorizedList(userId: string, listId: string) {
	if (!(await userHasModlistAccess(userId, listId)))
		throw new Error('You no longer have access to this list');
	const list = await db.select().from(modList).where(eq(modList.id, listId)).get();
	if (!list) throw new Error('List not found');
	const mods = await db.select().from(mod).where(eq(mod.modlist, listId));
	return { list, mods };
}
const storedModSchema = z.object({
	id: z.string(),
	name: z.string(),
	modlist: z.string(),
	enabled: z.boolean().nullable(),
	icebox: z.boolean().nullable(),
	essential: z.boolean().nullable(),
	autoDependency: z.boolean(),
	title: z.string().nullable(),
	summary: z.string().nullable(),
	description: z.string().nullable(),
	category: z.string().nullable(),
	tags: z.string().nullable(),
	thumbnail: z.string().nullable(),
	downloadsCount: z.number().nullable(),
	lastUpdated: z.coerce.date().nullable(),
	version: z.string().nullable(),
	factorioVersion: z.string().nullable(),
	dependencies: z.string().nullable(),
	lastFetched: z.coerce.date().nullable(),
	fetchError: z.string().nullable(),
	updatedBy: z.string().nullable()
});
const storedPlan = z.object({
	mods: z.array(storedModSchema),
	changes: z.array(z.string()),
	details: z
		.array(
			z.object({
				name: z.string(),
				title: z.string(),
				action: z.enum([
					'add',
					'remove',
					'enable',
					'disable',
					'icebox',
					'update',
					'lock',
					'unlock'
				]),
				version: z.string().nullable(),
				dependency: z.boolean(),
				requiredBy: z.array(z.string()).optional()
			})
		)
		.optional(),
	requestedChanges: z.array(changeSchema).optional(),
	requestId: z.string().optional()
});
function requestedChanges(changes: RequestedModChange[]) {
	const unique = new Map<string, RequestedModChange>();
	for (const change of changes) {
		const dimension =
			change.action === 'lock' || change.action === 'unlock'
				? 'lock'
				: change.action === 'set_version'
					? 'version'
					: 'status';
		const key = `${change.name}:${dimension}`;
		const previous = unique.get(key);
		if (previous && (previous.action !== change.action || previous.version !== change.version))
			throw new Error(`${change.name} has conflicting changes in this review`);
		unique.set(key, change);
	}
	const result = [...unique.values()];
	for (const change of result) {
		const status = result.find(
			(other) =>
				other.name === change.name &&
				['enable', 'disable', 'remove', 'icebox'].includes(other.action)
		);
		if (change.action === 'lock' && status && status.action !== 'enable')
			throw new Error(`${change.name} cannot combine lock with ${status.action}`);
		if (change.action === 'set_version' && status?.action === 'remove')
			throw new Error(`${change.name} cannot be removed and assigned a release together`);
	}
	const priority = (change: RequestedModChange) =>
		change.action === 'unlock'
			? 0
			: change.action === 'set_version'
				? 3
				: change.action === 'lock'
					? 2
					: 1;
	return result.toSorted((a, b) => priority(a) - priority(b));
}
function planIdForKey(key: string) {
	return `plan-${createHash('sha256').update(`facmandu-mod-plan:${key}`).digest('hex')}`;
}
function planSummary(plan: { id: string; body: string; applied: boolean }) {
	const body = storedPlan.parse(JSON.parse(plan.body));
	return { id: plan.id, changes: body.changes, details: body.details ?? [], applied: plan.applied };
}
class StaleModlistPlanError extends Error {}
export async function prepareModlistPlan(
	userId: string,
	listId: string,
	input: z.infer<typeof planInputSchema>,
	chatId?: string,
	idempotencyKey?: string,
	requestId?: string
) {
	input = planInputSchema.parse(input);
	const { list, mods } = await authorizedList(userId, listId);
	const id = idempotencyKey ? planIdForKey(idempotencyKey) : genID('plan');
	if (idempotencyKey) {
		const previous = await db.select().from(modlistPlan).where(eq(modlistPlan.id, id)).get();
		if (previous) {
			if (previous.userId !== userId || previous.listId !== listId || previous.chatId !== chatId)
				throw new Error('Change not found');
			return planSummary(previous);
		}
	}
	const requested = requestedChanges(input.changes);
	const next = new Map(mods.map((item) => [item.name, { ...item }]));
	const disabled = new Set<string>();
	const pinned = new Map<string, string>();
	for (const change of requested) {
		const item = next.get(change.name);
		if (isBundledMod(change.name)) {
			if (!item) throw new Error(`${change.name} is not installed in this list`);
			if (change.action === 'set_version')
				throw new Error('Bundled mods use the installed Factorio version');
			if (
				change.action === 'remove' ||
				change.action === 'icebox' ||
				(change.name === 'base' && change.action === 'disable')
			)
				throw new Error(`${change.name} must remain in the active mod list`);
		}
		if (item?.essential && !['enable', 'lock', 'unlock', 'set_version'].includes(change.action))
			throw new Error(`${item.title ?? item.name} is locked`);
		if (!item && !['enable', 'icebox', 'lock'].includes(change.action))
			throw new Error(`${change.name} is not in this list`);
		if (change.action === 'remove') next.delete(change.name);
		else if (item) {
			if (change.action === 'lock') {
				item.essential = true;
				item.enabled = true;
				item.icebox = false;
				item.autoDependency = false;
			} else if (change.action === 'unlock') item.essential = false;
			else if (change.action === 'set_version') pinned.set(change.name, change.version ?? '');
			else {
				item.enabled = change.action === 'enable';
				item.icebox = change.action === 'icebox';
				if (change.action === 'enable') item.autoDependency = false;
			}
			item.updatedBy = userId;
		} else
			next.set(change.name, {
				id: genID('mod'),
				name: change.name,
				modlist: listId,
				enabled: change.action !== 'icebox',
				icebox: change.action === 'icebox',
				essential: change.action === 'lock',
				autoDependency: false,
				title: null,
				summary: null,
				description: null,
				category: null,
				tags: null,
				thumbnail: null,
				downloadsCount: null,
				lastUpdated: null,
				version: null,
				factorioVersion: null,
				dependencies: null,
				lastFetched: null,
				fetchError: null,
				updatedBy: userId
			});
		if (['disable', 'remove', 'icebox'].includes(change.action)) disabled.add(change.name);
	}
	const catalogs = new Map<string, ReleaseCatalog>();
	const metadata = new Map<string, Awaited<ReturnType<typeof getPortalMod>>>();
	for (const [name, version] of pinned) {
		const info = await getPortalMod(name, true);
		if (info.warning || !info.data)
			throw new Error(`${name}: current release metadata could not be verified`);
		const release = info.data.releases.find((candidate) => candidate.version === version);
		if (!release) throw new Error(`${name}: release ${version} is unavailable`);
		if (!supportsFactorio(release.info_json.factorio_version, list.factorioVersion))
			throw new Error(`${name} ${version} does not support Factorio ${list.factorioVersion}`);
		if (inspectDependencies(JSON.stringify(release.info_json.dependencies)).errors.length)
			throw new Error(`${name} ${version} has invalid dependency metadata`);
		const item = next.get(name);
		if (!item) throw new Error(`${name} is not in this list`);
		Object.assign(item, modMetadataValues(info.data, release, info.fetchedAt));
		metadata.set(name, info);
		catalogs.set(name, {
			complete: true,
			releases: info.data.releases.map((candidate) => ({
				version: candidate.version,
				factorioVersion: candidate.info_json.factorio_version,
				dependencies: candidate.info_json.dependencies
			}))
		});
	}
	for (const item of next.values())
		if (
			!catalogs.has(item.name) &&
			item.version &&
			item.factorioVersion &&
			item.dependencies !== null &&
			!inspectDependencies(item.dependencies).errors.length
		)
			catalogs.set(item.name, {
				complete: false,
				releases: [
					{
						version: item.version,
						factorioVersion: item.factorioVersion,
						dependencies: JSON.parse(item.dependencies)
					}
				]
			});
	let resolution = resolveModList([...next.values()], catalogs, list.factorioVersion);
	// Match the existing resolver's bound. Missing catalogs are fetched through the durable portal cache.
	for (let pass = 0; pass < 100 && resolution.missingMetadata.length; pass++) {
		if (metadata.size + resolution.missingMetadata.length > 1000)
			throw new Error('This change exceeds the 1,000-mod dependency limit');
		for (let offset = 0; offset < resolution.missingMetadata.length; offset += 2)
			await Promise.all(
				resolution.missingMetadata.slice(offset, offset + 2).map(async (name) => {
					const info = await getPortalMod(name, true);
					if (info.warning)
						throw new Error(`${name}: current release metadata could not be verified`);
					if (!info.data) throw new Error(`${name}: metadata unavailable`);
					metadata.set(name, info);
					catalogs.set(name, {
						complete: true,
						releases: info.data.releases.map((release) => ({
							version: release.version,
							factorioVersion: release.info_json.factorio_version,
							dependencies: release.info_json.dependencies
						}))
					});
				})
			);
		resolution = resolveModList([...next.values()], catalogs, list.factorioVersion);
	}
	if (!resolution.stable || resolution.issues.length || resolution.missingMetadata.length)
		throw new Error(
			resolution.issues
				.slice(0, 8)
				.map((issue) => `${issue.mod}: ${issue.message}`)
				.join('\n') || 'Dependencies could not be resolved'
		);
	for (const [name, version] of pinned)
		if (next.get(name)?.enabled && resolution.selected.get(name)?.version !== version)
			throw new Error(`${name} ${version} conflicts with required dependency versions`);
	for (const [name, release] of resolution.selected) {
		if (disabled.has(name))
			throw new Error(
				`${name} is required by an enabled mod. Disable its dependants in the same change.`
			);
		let item = next.get(name);
		const info = metadata.get(name);
		const portalRelease = info?.data?.releases.find(
			(candidate) => candidate.version === release.version
		);
		if (!item) {
			if (!info?.data || !portalRelease) throw new Error(`${name}: metadata unavailable`);
			item = {
				id: genID('mod'),
				name,
				modlist: listId,
				enabled: true,
				icebox: false,
				essential: false,
				autoDependency: true,
				...modMetadataValues(info.data, portalRelease, info.fetchedAt),
				updatedBy: userId
			};
			next.set(name, item);
		} else {
			item.enabled = true;
			item.icebox = false;
			if (info?.data && portalRelease)
				Object.assign(item, modMetadataValues(info.data, portalRelease, info.fetchedAt));
		}
	}
	for (const change of requested) {
		if (!isBundledMod(change.name)) continue;
		const before = mods.find((item) => item.name === change.name);
		const after = next.get(change.name);
		if (
			!before ||
			!after ||
			Boolean(before.enabled && !before.icebox) === Boolean(after.enabled && !after.icebox)
		)
			continue;
		if (after.enabled) {
			for (const dependency of inspectDependencies(after.dependencies).dependencies) {
				const target = next.get(dependency.name);
				if (
					dependency.type === 'required' &&
					dependency.name !== 'base' &&
					(!target?.enabled || target.icebox)
				)
					throw new Error(`${change.name} requires enabled ${dependency.name}`);
				if (dependency.type === 'conflict' && target?.enabled && !target.icebox)
					throw new Error(`${change.name} conflicts with enabled ${dependency.name}`);
			}
		}
		for (const item of next.values()) {
			if (!item.enabled || item.icebox || item.name === change.name) continue;
			const dependencies = inspectDependencies(item.dependencies).dependencies;
			if (
				!after.enabled &&
				dependencies.some(
					(dependency) => dependency.name === change.name && dependency.type === 'required'
				)
			)
				throw new Error(`${change.name} is required by enabled ${item.title ?? item.name}`);
			if (
				after.enabled &&
				dependencies.some(
					(dependency) => dependency.name === change.name && dependency.type === 'conflict'
				)
			)
				throw new Error(`${change.name} conflicts with enabled ${item.title ?? item.name}`);
		}
	}
	const requiredBy = new Map<string, Map<string, string>>();
	for (const parent of next.values()) {
		if (!parent.enabled || parent.icebox) continue;
		for (const dependency of inspectDependencies(parent.dependencies).dependencies) {
			if (dependency.type !== 'required') continue;
			const target = next.get(dependency.name);
			if (!target?.enabled || target.icebox) continue;
			const parents = requiredBy.get(dependency.name) ?? new Map<string, string>();
			parents.set(parent.name, parent.title ?? parent.name);
			requiredBy.set(dependency.name, parents);
		}
	}
	const changes: string[] = [];
	const details: ModlistPlanDetail[] = [];
	for (const old of mods)
		if (!next.has(old.name)) {
			changes.push(`Remove ${old.title ?? old.name}`);
			details.push({
				name: old.name,
				title: old.title ?? old.name,
				action: 'remove',
				version: old.version,
				dependency: false
			});
		}
	for (const item of next.values()) {
		const old = mods.find((old) => old.name === item.name);
		const parents = item.autoDependency
			? [...(requiredBy.get(item.name)?.values() ?? [])]
			: undefined;
		if (!old) {
			changes.push(
				`Add ${item.title ?? item.name} ${item.version ?? ''}${parents?.length ? ` (required by ${parents.join(', ')})` : ''}${item.essential ? ' (locked)' : ''}`
			);
			details.push({
				name: item.name,
				title: item.title ?? item.name,
				action: 'add',
				version: item.version,
				dependency: item.autoDependency,
				...(parents ? { requiredBy: parents } : {})
			});
		} else if (item.icebox !== old.icebox || item.enabled !== old.enabled) {
			changes.push(
				`${item.icebox ? 'Icebox' : item.enabled ? 'Enable' : 'Disable'} ${item.title ?? item.name}`
			);
			details.push({
				name: item.name,
				title: item.title ?? item.name,
				action: item.icebox ? 'icebox' : item.enabled ? 'enable' : 'disable',
				version: item.version,
				dependency: false,
				...(parents ? { requiredBy: parents } : {})
			});
		}
		if (old && item.essential !== old.essential) {
			changes.push(`${item.essential ? 'Lock' : 'Unlock'} ${item.title ?? item.name}`);
			details.push({
				name: item.name,
				title: item.title ?? item.name,
				action: item.essential ? 'lock' : 'unlock',
				version: item.version,
				dependency: false
			});
		}
		if (old && old.version !== item.version) {
			changes.push(`Update ${item.title ?? item.name}: ${old.version} → ${item.version}`);
			details.push({
				name: item.name,
				title: item.title ?? item.name,
				action: 'update',
				version: item.version,
				dependency: item.autoDependency,
				...(parents ? { requiredBy: parents } : {})
			});
		}
	}
	if (!changes.length) throw new Error('The list already matches these changes');
	const body = JSON.stringify({
		mods: [...next.values()],
		changes,
		details,
		requestedChanges: requested,
		requestId
	});
	await db
		.insert(modlistPlan)
		.values({
			chatId,
			id,
			userId,
			listId,
			snapshot: modlistSnapshot(list.name, list.factorioVersion, mods),
			body,
			createdAt: new Date()
		})
		.onConflictDoNothing();
	if (idempotencyKey) {
		const stored = await db.select().from(modlistPlan).where(eq(modlistPlan.id, id)).get();
		if (!stored || stored.userId !== userId || stored.listId !== listId || stored.chatId !== chatId)
			throw new Error('Change not found');
		return planSummary(stored);
	}
	return { id, changes, details, applied: false };
}
const turnPlanLocks = new Map<string, Promise<void>>();
export async function prepareTurnModlistPlan(
	userId: string,
	listId: string,
	input: z.infer<typeof planInputSchema>,
	chatId: string,
	requestId: string
) {
	const key = `${userId}:${listId}:${chatId}:${requestId}`;
	const previousTask = turnPlanLocks.get(key) ?? Promise.resolve();
	let release = () => {};
	const thisTask = new Promise<void>((resolve) => {
		release = resolve;
	});
	turnPlanLocks.set(key, thisTask);
	await previousTask;
	try {
		const recent = await db
			.select()
			.from(modlistPlan)
			.where(
				and(
					eq(modlistPlan.userId, userId),
					eq(modlistPlan.listId, listId),
					eq(modlistPlan.chatId, chatId)
				)
			)
			.orderBy(desc(modlistPlan.createdAt), sql`modlist_plan.rowid DESC`)
			.limit(40);
		const previous = recent.find(
			(plan) => !plan.applied && storedPlan.parse(JSON.parse(plan.body)).requestId === requestId
		);
		const priorChanges = previous
			? (storedPlan.parse(JSON.parse(previous.body)).requestedChanges ?? [])
			: [];
		const combined = requestedChanges([...priorChanges, ...input.changes]);
		const next = await prepareModlistPlan(
			userId,
			listId,
			{ changes: combined },
			chatId,
			undefined,
			requestId
		);
		if (!previous) return next;
		let reused = false;
		await db.transaction(
			async (tx) => {
				const oldRow = await tx
					.select()
					.from(modlistPlan)
					.where(eq(modlistPlan.id, previous.id))
					.get();
				if (!oldRow || oldRow.applied) return;
				const nextRow = await tx
					.select()
					.from(modlistPlan)
					.where(eq(modlistPlan.id, next.id))
					.get();
				if (!nextRow) throw new Error('Change not found');
				await tx
					.update(modlistPlan)
					.set({ body: nextRow.body, snapshot: nextRow.snapshot, createdAt: nextRow.createdAt })
					.where(eq(modlistPlan.id, previous.id));
				await tx.delete(modlistPlan).where(eq(modlistPlan.id, next.id));
				reused = true;
			},
			{ behavior: 'immediate' }
		);
		return reused ? { ...next, id: previous.id } : next;
	} finally {
		release();
		if (turnPlanLocks.get(key) === thisTask) turnPlanLocks.delete(key);
	}
}
export async function refreshModlistPlan(
	userId: string,
	listId: string,
	id: string,
	chatId: string,
	originId?: string
) {
	await authorizedList(userId, listId);
	const previous = await db
		.select()
		.from(modlistPlan)
		.where(
			and(
				eq(modlistPlan.id, id),
				eq(modlistPlan.userId, userId),
				eq(modlistPlan.listId, listId),
				eq(modlistPlan.chatId, chatId)
			)
		)
		.get();
	if (!previous) throw new Error('Change not found');
	if (previous.applied) throw new Error('These changes were already applied');
	const body = storedPlan.parse(JSON.parse(previous.body));
	const requested = body.requestedChanges;
	if (!requested) throw new Error('This older review cannot be refreshed. Select the mods again.');
	return prepareModlistPlan(
		userId,
		listId,
		{ changes: requested },
		chatId,
		undefined,
		body.requestId ?? originId
	);
}
export function reviewAdditions(body: string) {
	const parsed = storedPlan.parse(JSON.parse(body));
	if (parsed.requestedChanges) {
		if (parsed.requestedChanges.some((change) => change.action !== 'enable')) return null;
		return parsed.requestedChanges.map((change) => change.name);
	}
	const names: string[] = [];
	for (const change of parsed.changes) {
		const item = parsed.mods.find(
			(candidate) =>
				change ===
				`Add ${candidate.title ?? candidate.name} ${candidate.version ?? ''}${candidate.autoDependency ? ' (required dependency)' : ''}`
		);
		if (!item) return null;
		if (!item.autoDependency) names.push(item.name);
	}
	return names.length ? names : null;
}
export async function combineModlistPlans(
	userId: string,
	listId: string,
	ids: string[],
	chatId: string,
	originId?: string
) {
	if (ids.length < 2 || ids.length > 10 || new Set(ids).size !== ids.length)
		throw new Error('Choose two to ten distinct reviews');
	await authorizedList(userId, listId);
	const plans = await Promise.all(
		ids.map((id) =>
			db
				.select()
				.from(modlistPlan)
				.where(
					and(
						eq(modlistPlan.id, id),
						eq(modlistPlan.userId, userId),
						eq(modlistPlan.listId, listId),
						eq(modlistPlan.chatId, chatId)
					)
				)
				.get()
		)
	);
	if (plans.some((plan) => !plan) || new Set(plans.map((plan) => plan?.snapshot)).size !== 1)
		throw new Error('These reviews are unrelated. Select the mods together for a fresh review.');
	const additions = plans.map((plan) => (plan ? reviewAdditions(plan.body) : null));
	if (additions.some((names) => names === null))
		throw new Error('These reviews include changes that cannot be combined automatically.');
	const names = [...new Set(additions.flatMap((names) => names ?? []))];
	if (!names.length) throw new Error('No additions were found in these reviews');
	return prepareModlistPlan(
		userId,
		listId,
		{ changes: names.map((name) => ({ name, action: 'enable' as const })) },
		chatId,
		undefined,
		originId
	);
}
export async function applyModlistChanges(
	userId: string,
	listId: string,
	input: z.infer<typeof planInputSchema>,
	chatId: string,
	idempotencyKey: string,
	requestId?: string
) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const plan = await prepareModlistPlan(
			userId,
			listId,
			input,
			chatId,
			`${idempotencyKey}:${attempt}`,
			requestId
		);
		if (plan.applied) return plan;
		try {
			await applyModlistPlan(userId, listId, plan.id);
			return { ...plan, applied: true };
		} catch (cause) {
			if (!(cause instanceof StaleModlistPlanError) || attempt === 1) throw cause;
		}
	}
	throw new Error('Could not apply these changes');
}
export async function applyModlistPlan(userId: string, listId: string, id: string) {
	await authorizedList(userId, listId);
	let applied = false;
	await db.transaction(
		async (tx) => {
			const allowed = await tx
				.select({ id: modList.id })
				.from(modList)
				.leftJoin(
					modListCollaborator,
					and(eq(modListCollaborator.modlistId, modList.id), eq(modListCollaborator.userId, userId))
				)
				.where(
					and(
						eq(modList.id, listId),
						or(eq(modList.owner, userId), eq(modListCollaborator.userId, userId))
					)
				)
				.get();
			if (!allowed) throw new Error('You no longer have access to this list');
			const plan = await tx
				.select()
				.from(modlistPlan)
				.where(
					and(
						eq(modlistPlan.id, id),
						eq(modlistPlan.userId, userId),
						eq(modlistPlan.listId, listId)
					)
				)
				.get();
			if (!plan) throw new Error('Change not found');
			if (plan.applied) return;
			if (Date.now() - plan.createdAt.getTime() > 3600_000)
				throw new Error('This review expired. Refresh it before applying.');
			const list = await tx.select().from(modList).where(eq(modList.id, listId)).get();
			const current = await tx.select().from(mod).where(eq(mod.modlist, listId));
			if (!list || modlistSnapshot(list.name, list.factorioVersion, current) !== plan.snapshot)
				throw new StaleModlistPlanError('The list changed. Refresh this review before applying.');
			const body = storedPlan.parse(JSON.parse(plan.body));
			for (const item of current)
				if (!body.mods.some((next) => next.id === item.id))
					await tx.delete(mod).where(eq(mod.id, item.id));
			for (const item of body.mods) {
				if (JSON.stringify(current.find((old) => old.id === item.id)) === JSON.stringify(item))
					continue;
				await tx
					.insert(mod)
					.values({ ...item, updatedBy: userId })
					.onConflictDoUpdate({ target: mod.id, set: { ...item, updatedBy: userId } });
			}
			await tx.update(modlistPlan).set({ applied: true }).where(eq(modlistPlan.id, id));
			applied = true;
		},
		{ behavior: 'immediate' }
	);
	if (applied) publishModlistEvent(listId, 'mods-updated', {});
}
