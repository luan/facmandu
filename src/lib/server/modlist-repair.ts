import { isDeepStrictEqual } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import {
	bundledModTitle,
	compareVersions,
	inspectDependencies,
	isBundledMod,
	supportsFactorio
} from '$lib/dependencies';
import { type ReleaseCatalog, resolveModList } from '$lib/mod-resolution';
import { publishActivity } from '$lib/server/activity';
import { db } from '$lib/server/db';
import { type Mod, mod, modList } from '$lib/server/db/schema';
import { latestCompatibleRelease, modMetadataValues } from '$lib/server/mod-metadata';
import { validModName } from '$lib/server/mod-names';
import { getPortalMod, getPortalModForFactorio, type PortalMod } from '$lib/server/portal-cache';
import { publishModlistEvent } from '$lib/server/realtime';

export type RepairProgress = {
	state: 'running' | 'done' | 'error';
	message: string;
	completed: number;
	total: number;
	metadataUpdated: number;
	dependenciesAdded: number;
	dependenciesEnabled: number;
	cacheHits: number;
	networkRequests: number;
	issues: string[];
	changes: string[];
};
type RepairJob = {
	progress: RepairProgress;
	rerun: boolean;
	refresh: boolean;
	refreshNames: string[];
	finishedAt?: number;
};
// Repairs are idempotent after restart. Use a database lease before adding app processes.
const repairs = new Map<string, RepairJob>();
const metadataFields = [
	'title',
	'summary',
	'description',
	'category',
	'tags',
	'thumbnail',
	'downloadsCount',
	'lastUpdated',
	'version',
	'factorioVersion',
	'dependencies',
	'lastFetched',
	'fetchError'
] as const satisfies readonly (keyof ReturnType<typeof modMetadataValues>)[];
const refreshedMetadata = Object.fromEntries(
	metadataFields.map((field) => [field, sql`excluded.${sql.identifier(mod[field].name)}`])
);

const lastReport = new WeakMap<RepairProgress, number>();
function report(modlistId: string, progress: RepairProgress) {
	const now = Date.now();
	if (progress.state === 'running' && now - (lastReport.get(progress) ?? 0) < 100) return;
	lastReport.set(progress, now);
	publishActivity({
		scope: 'modlist',
		targetId: modlistId,
		state: progress.state === 'done' && progress.issues.length ? 'error' : progress.state,
		message: progress.message,
		details: progress.state === 'running' ? undefined : [...progress.changes, ...progress.issues],
		completed: progress.completed,
		total: progress.total
	});
	publishModlistEvent(modlistId, 'repair-progress', {
		...progress,
		issues: [...progress.issues],
		changes: [...progress.changes]
	});
}
export function repairProgress(modlistId: string): RepairProgress | null {
	return repairs.get(modlistId)?.progress ?? null;
}
const snapshot = (mods: Mod[]) =>
	JSON.stringify(
		mods
			.map((item) => [
				item.id,
				item.name,
				item.enabled,
				item.icebox,
				item.version,
				item.dependencies
			])
			.sort()
	);

async function runRepair(modlistId: string, userId: string, job: RepairJob) {
	const progress = job.progress;
	const refresh = job.refresh;
	const refreshNames = job.refreshNames;
	job.refresh = false;
	job.refreshNames = [];
	const list = await db.select().from(modList).where(eq(modList.id, modlistId)).get();
	if (!list) {
		progress.state = 'done';
		progress.message = 'List removed';
		report(modlistId, progress);
		return;
	}
	const factorioVersion = list.factorioVersion;
	const mods = await db.select().from(mod).where(eq(mod.modlist, modlistId));
	const catalogs = new Map<string, ReleaseCatalog>();
	const metadata = new Map<string, PortalMod>();
	const fetchedAt = new Map<string, number>();
	const fetched = new Set<string>();
	const refreshes = new Set<string>();

	for (const item of mods) {
		if (
			item.lastFetched &&
			item.title &&
			item.version &&
			item.factorioVersion &&
			item.dependencies !== null &&
			!item.fetchError &&
			!inspectDependencies(item.dependencies).errors.length
		) {
			catalogs.set(item.name, {
				complete: false,
				releases: [
					{
						version: item.version,
						factorioVersion: item.factorioVersion,
						dependencies: inspectDependencies(item.dependencies).dependencies.map(
							(dependency) =>
								`${dependency.type === 'conflict' ? '! ' : dependency.type === 'optional' ? '? ' : ''}${dependency.name}${dependency.version ? ` ${dependency.version.operator} ${dependency.version.version}` : ''}`
						)
					}
				]
			});
		}
	}
	async function fetchMetadata(names: string[], refresh = false) {
		const needed = [...new Set(names)].filter(
			(name) => !isBundledMod(name) && (refresh ? !refreshes.has(name) : !fetched.has(name))
		);
		progress.total += needed.length;
		async function fetchOne(name: string) {
			fetched.add(name);
			if (refresh) refreshes.add(name);
			progress.message = `Checking metadata: ${name}`;
			report(modlistId, progress);
			try {
				if (!validModName(name)) throw new Error('Invalid mod name');
				const result = refresh
					? await getPortalMod(name, true)
					: await getPortalModForFactorio(name, factorioVersion);
				if (result.warning) throw new Error('Current release metadata could not be verified');
				if (result.source === 'cache') progress.cacheHits++;
				else progress.networkRequests++;
				fetchedAt.set(name, result.fetchedAt);
				if (!result.data) throw new Error('Mod not found on the portal');
				metadata.set(name, result.data);
				catalogs.set(name, {
					complete: true,
					releases: result.data.releases
						.filter((release) => compareVersions(release.version, release.version) !== null)
						.map((release) => ({
							version: release.version,
							factorioVersion: release.info_json.factorio_version,
							dependencies: release.info_json.dependencies
						}))
				});
			} catch (cause) {
				catalogs.set(name, { complete: false, releases: catalogs.get(name)?.releases ?? [] });
				progress.issues.push(
					`${name}: ${cause instanceof Error ? cause.message : 'Metadata unavailable'}`
				);
			}
			progress.completed++;
			report(modlistId, progress);
		}
		for (let offset = 0; offset < needed.length; offset += 2)
			await Promise.all(needed.slice(offset, offset + 2).map(fetchOne));
	}
	await fetchMetadata(
		mods.filter((item) => refresh || !catalogs.has(item.name)).map((item) => item.name),
		refresh
	);
	await fetchMetadata(refreshNames, true);
	const updateNames = new Set(refresh ? mods.map((item) => item.name) : refreshNames);
	let resolution = resolveModList(mods, catalogs, list.factorioVersion, updateNames);
	for (let pass = 0; pass < 100; pass++) {
		const needed = resolution.missingMetadata.filter((name) => !fetched.has(name));
		if (needed.length) {
			if (fetched.size + needed.length > 1000) {
				progress.issues.push('Metadata limit reached; review this list manually.');
				break;
			}
			await fetchMetadata(needed);
		} else {
			// Recheck unresolved releases at most daily; explicit refresh remains immediate.
			const outdated = resolution.issues
				.map((issue) => issue.mod)
				.filter(
					(name) =>
						fetchedAt.has(name) &&
						Date.now() - (fetchedAt.get(name) ?? 0) > 24 * 60 * 60_000 &&
						!refreshes.has(name)
				);
			if (!outdated.length) break;
			await fetchMetadata(outdated, true);
		}
		resolution = resolveModList(mods, catalogs, list.factorioVersion, updateNames);
	}
	progress.issues.push(
		...resolution.issues.map((issue) => `${issue.mod ? `${issue.mod}: ` : ''}${issue.message}`)
	);
	progress.issues = [...new Set(progress.issues)];
	const updates: {
		id: string;
		metadataChanged: boolean;
		versionChange: string | null;
		values: Partial<Pick<Mod, keyof ReturnType<typeof modMetadataValues>>>;
	}[] = [];
	for (const item of mods) {
		const bundledTitle = bundledModTitle(item.name);
		if (bundledTitle) {
			// Bundled mods have reserved portal entries; their versions come from Factorio.
			const values = {
				title: bundledTitle,
				version: null,
				summary: null,
				description: null,
				dependencies: null,
				factorioVersion: list.factorioVersion,
				category: null,
				tags: null,
				thumbnail: null,
				downloadsCount: null,
				lastUpdated: null,
				lastFetched: null,
				fetchError: null
			};
			if (!isDeepStrictEqual({ ...item, ...values }, item))
				updates.push({ id: item.id, values, metadataChanged: true, versionChange: null });
			continue;
		}
		const info = metadata.get(item.name);
		const checkedAt = fetchedAt.get(item.name);
		if (!info || checkedAt === undefined) continue;
		const selected = resolution.selected.get(item.name);
		const preserveVersion =
			item.version && (!resolution.stable || resolution.blocked.has(item.name));
		const release = preserveVersion
			? info.releases.find((candidate) => candidate.version === item.version)
			: selected
				? info.releases.find(
						(candidate) =>
							candidate.version === selected.version &&
							supportsFactorio(candidate.info_json.factorio_version, list.factorioVersion)
					)
				: updateNames.has(item.name)
					? latestCompatibleRelease(info, list.factorioVersion)
					: (info.releases.find(
							(candidate) =>
								candidate.version === item.version &&
								supportsFactorio(candidate.info_json.factorio_version, list.factorioVersion)
						) ?? latestCompatibleRelease(info, list.factorioVersion));
		const values = release
			? modMetadataValues(info, release, checkedAt)
			: {
					lastFetched: new Date(Math.floor(checkedAt / 1000) * 1000),
					fetchError: `No compatible release for Factorio ${list.factorioVersion}`
				};
		if (!isDeepStrictEqual({ ...item, ...values }, item))
			updates.push({
				id: item.id,
				values,
				versionChange:
					release && release.version !== item.version
						? `${item.name}: ${item.version || 'unresolved'} → ${release.version}`
						: null,
				metadataChanged:
					'version' in values &&
					!isDeepStrictEqual({ ...item, ...values, lastFetched: item.lastFetched }, item)
			});
	}
	const additions =
		resolution.stable && !resolution.missingMetadata.length ? resolution.additions : [];
	progress.message = 'Saving resolved metadata and dependencies';
	report(modlistId, progress);
	const committed = {
		metadataUpdated: 0,
		dependenciesAdded: 0,
		dependenciesEnabled: 0,
		changes: [] as string[]
	};
	if (updates.length || additions.length)
		await db.transaction(async (tx) => {
			const current = await tx.select().from(mod).where(eq(mod.modlist, modlistId));
			const currentList = await tx.select().from(modList).where(eq(modList.id, modlistId)).get();
			if (!currentList) return;
			if (
				snapshot(current) !== snapshot(mods) ||
				currentList.factorioVersion !== list.factorioVersion
			) {
				job.rerun = true;
				return;
			}
			const currentById = new Map(current.map((item) => [item.id, item]));
			// Twenty complete rows stay below SQLite's 999-parameter limit and avoid a remote round trip per mod.
			for (let offset = 0; offset < updates.length; offset += 20) {
				const rows = updates.slice(offset, offset + 20).flatMap((update) => {
					const item = currentById.get(update.id);
					return item ? [{ ...item, ...update.values }] : [];
				});
				if (rows.length)
					await tx
						.insert(mod)
						.values(rows)
						.onConflictDoUpdate({ target: mod.id, set: refreshedMetadata });
			}
			for (const update of updates) {
				if (update.metadataChanged) committed.metadataUpdated++;
				if (update.versionChange) committed.changes.push(update.versionChange);
			}
			if (resolution.stable && !resolution.missingMetadata.length) {
				for (const name of additions) {
					const existing = mods.find((item) => item.name === name);
					if (existing) {
						await tx
							.update(mod)
							.set({ enabled: true, icebox: false, updatedBy: userId })
							.where(eq(mod.id, existing.id));
						committed.dependenciesEnabled++;
						committed.changes.push(`Enabled ${name}`);
					} else {
						const info = metadata.get(name);
						const selected = resolution.selected.get(name);
						const release = info?.releases.find(
							(candidate) =>
								candidate.version === selected?.version &&
								supportsFactorio(candidate.info_json.factorio_version, list.factorioVersion)
						);
						const checkedAt = fetchedAt.get(name);
						if (!info || !release || checkedAt === undefined) continue;
						await tx
							.insert(mod)
							.values({
								id: crypto.randomUUID(),
								modlist: modlistId,
								name,
								enabled: true,
								icebox: false,
								autoDependency: true,
								updatedBy: userId,
								...modMetadataValues(info, release, checkedAt)
							})
							.onConflictDoNothing();
						committed.dependenciesAdded++;
						committed.changes.push(`Added ${name}`);
					}
				}
			}
		});
	progress.metadataUpdated += committed.metadataUpdated;
	progress.dependenciesAdded += committed.dependenciesAdded;
	progress.dependenciesEnabled += committed.dependenciesEnabled;
	progress.changes.push(...committed.changes);
	progress.state = 'done';
	progress.message = progress.issues.length
		? 'Automatic repair finished · some issues need review'
		: 'Dependencies and metadata are ready';
	report(modlistId, progress);
	publishModlistEvent(modlistId, 'modlist-repaired');
}

export function startModlistRepair(
	modlistId: string,
	userId: string,
	options: { changed?: boolean; refresh?: boolean; refreshNames?: string[] } = {}
): RepairProgress {
	const current = repairs.get(modlistId);
	if (
		current?.progress.state === 'done' &&
		!options.changed &&
		!options.refresh &&
		!options.refreshNames?.length &&
		Date.now() - (current.finishedAt ?? 0) < 60_000
	)
		return current.progress;
	if (current?.progress.state === 'running') {
		current.rerun ||= !!(options.changed || options.refresh || options.refreshNames?.length);
		current.refresh ||= options.refresh ?? false;
		current.refreshNames.push(...(options.refreshNames ?? []));
		return current.progress;
	}
	const progress: RepairProgress = {
		state: 'running',
		message: 'Checking local metadata',
		completed: 0,
		total: 0,
		metadataUpdated: 0,
		dependenciesAdded: 0,
		dependenciesEnabled: 0,
		cacheHits: 0,
		networkRequests: 0,
		issues: [],
		changes: []
	};
	const job: RepairJob = {
		progress,
		rerun: false,
		refresh: options.refresh ?? false,
		refreshNames: options.refreshNames ?? []
	};
	if (repairs.size >= 100) {
		const finished = [...repairs].find(([, item]) => item.progress.state !== 'running');
		if (finished) repairs.delete(finished[0]);
	}
	repairs.set(modlistId, job);
	report(modlistId, progress);
	void runRepair(modlistId, userId, job)
		.catch((cause: unknown) => {
			console.error('Mod list repair failed:', cause);
			progress.state = 'error';
			progress.message = 'Could not finish automatic repair';
			progress.issues.push(cause instanceof Error ? cause.message : 'Unknown error');
			report(modlistId, progress);
		})
		.finally(() => {
			job.finishedAt = Date.now();
			if (job.rerun)
				startModlistRepair(modlistId, userId, {
					changed: true,
					refresh: job.refresh,
					refreshNames: job.refreshNames
				});
		});
	return progress;
}
