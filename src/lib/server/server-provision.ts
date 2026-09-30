import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { compareVersions, isBundledMod } from '$lib/dependencies';
import { publishActivity } from './activity';
import { db, userHasModlistAccess } from './db';
import * as table from './db/schema';
import { validModName } from './mod-names';
import {
	initializeServer,
	ServerError,
	safeFileName,
	serverConfig,
	updateServerConfig
} from './server-files';
import { type DesiredMod, planServerMods } from './server-mod-plan';
import { downloadMod, installMod, serverModInventory, serverMods, toggleMod } from './server-mods';
import { allocateServerPorts } from './server-ports';
import { processState, startFactorio } from './server-process';
import { createSave, savePath } from './server-saves';
import { reserveServer, serverTask } from './server-tasks';
import {
	type AvailableVersions,
	downloadVersion,
	factorioReleases,
	selectVersion,
	serverVersions
} from './server-versions';
import { canManageServer } from './servers';
import { validateDependencies } from './services/dependencies';

const releaseSchema = z.object({ branch: z.enum(['stable', 'experimental']), version: z.string() });
const desiredModSchema = z.object({
	name: z.string(),
	enabled: z.boolean().nullable(),
	icebox: z.boolean().nullable(),
	version: z.string().nullable(),
	factorioVersion: z.string().nullable(),
	dependencies: z.string().nullable()
});
const jobSchema = z.object({
	userId: z.string(),
	listId: z.string(),
	ownerId: z.string(),
	listName: z.string(),
	factorioVersion: z.string(),
	name: z.string(),
	saveName: z.string(),
	startRequested: z.boolean(),
	mods: z.array(desiredModSchema),
	release: releaseSchema.nullable(),
	status: z.enum(['running', 'done', 'failed']),
	stage: z.enum(['creating', 'version', 'mods', 'save', 'starting', 'ready']),
	error: z.string().nullable(),
	completed: z.number(),
	total: z.number()
});
type Job = z.infer<typeof jobSchema>;
export type ServerSetupStatus = ReturnType<typeof publicStatus>;
const stageMessage: Record<Job['stage'], string> = {
	creating: 'Creating server files',
	version: 'Installing Factorio',
	mods: 'Installing mods',
	save: 'Creating save',
	starting: 'Starting server',
	ready: 'Server ready'
};

function publicStatus(serverId: string, job: Job) {
	return {
		kind: 'server_setup' as const,
		serverId,
		name: job.name,
		listId: job.listId,
		listName: job.listName,
		factorioVersion: job.factorioVersion,
		enabledMods: job.mods.filter((mod) => mod.enabled && !mod.icebox).length,
		release: job.release,
		saveName: job.saveName,
		status: job.status,
		stage: job.stage,
		error: job.error,
		url: `/servers/${encodeURIComponent(serverId)}`,
		startRequested: job.startRequested,
		completed: job.completed,
		total: job.total
	};
}

async function requireList(userId: string, listId: string) {
	if (!canManageServer(userId)) throw new ServerError(403, 'Server management is restricted');
	if (!(await userHasModlistAccess(userId, listId)))
		throw new ServerError(404, 'Mod list not found');
	const list = await db
		.select({
			id: table.modList.id,
			owner: table.modList.owner,
			name: table.modList.name,
			factorioVersion: table.modList.factorioVersion
		})
		.from(table.modList)
		.where(eq(table.modList.id, listId))
		.get();
	if (!list) throw new ServerError(404, 'Mod list not found');
	return list;
}

async function snapshotMods(listId: string): Promise<DesiredMod[]> {
	return await db
		.select({
			name: table.mod.name,
			enabled: table.mod.enabled,
			icebox: table.mod.icebox,
			version: table.mod.version,
			factorioVersion: table.mod.factorioVersion,
			dependencies: table.mod.dependencies
		})
		.from(table.mod)
		.where(eq(table.mod.modlist, listId));
}

function snapshotProblems(mods: DesiredMod[], factorioVersion: string) {
	const desired = mods.filter((mod) => mod.enabled && !mod.icebox);
	const issues = validateDependencies(desired, factorioVersion);
	return [
		...desired.flatMap((mod) =>
			!validModName(mod.name)
				? [`Invalid mod name: ${mod.name}`]
				: !isBundledMod(mod.name) && !mod.factorioVersion
					? [`No Factorio ${factorioVersion} release selected for ${mod.name}`]
					: !isBundledMod(mod.name) &&
							(!mod.version || compareVersions(mod.version, mod.version) === null)
						? [`No known version for ${mod.name}`]
						: []
		),
		...issues.compatibilityIssues.map(
			(issue) => `${issue.mod} targets Factorio ${issue.actual}, not ${issue.target}`
		),
		...issues.missingDependencies.map((name) => `Missing dependency: ${name}`),
		...issues.conflicts.map(({ mod, conflictsWith }) => `${mod} conflicts with ${conflictsWith}`),
		...issues.metadataErrors.map(({ mod, message }) => `${mod}: ${message}`),
		...issues.versionIssues.map(
			({ mod, dependency, requirement, actual }) =>
				`${mod} requires ${dependency} ${requirement}; found ${actual ?? 'unknown version'}`
		)
	];
}

async function matchingRelease(factorioVersion: string) {
	const servers = await db.select().from(table.managedServer);
	const installed = (
		await Promise.all(
			servers.map(async (server) => {
				const versions = await serverVersions(server);
				const candidates = Object.entries(versions.installed).flatMap(([branch, values]) =>
					values
						.filter((version) => version.startsWith(`${factorioVersion}.`))
						.map((version) => ({
							branch: branch as 'stable' | 'experimental',
							version,
							source: server.directory
						}))
				);
				return (
					await Promise.all(
						candidates.map(async (candidate) =>
							(await stat(
								join(
									server.directory,
									'versions',
									candidate.branch,
									candidate.version,
									'data',
									'base',
									'info.json'
								)
							).catch(() => null))
								? candidate
								: null
						)
					)
				).filter((candidate) => candidate !== null);
			})
		)
	).flat();
	const latest: AvailableVersions = (await factorioReleases().catch(() => null))?.data ?? {};
	const available = (['stable', 'experimental'] as const).flatMap((branch) => {
		const version = latest[branch]?.headless;
		return version?.startsWith(`${factorioVersion}.`) ? [{ branch, version, source: null }] : [];
	});
	const chosen = [...installed, ...available].sort(
		(a, b) =>
			(compareVersions(b.version, a.version) ?? 0) ||
			Number(a.branch === 'experimental') - Number(b.branch === 'experimental')
	)[0];
	return chosen ?? null;
}

export async function inspectServerSetup(userId: string, listId: string) {
	const list = await requireList(userId, listId);
	const mods = await snapshotMods(listId);
	const release = await matchingRelease(list.factorioVersion);
	const owner = await db
		.select({ username: table.user.factorioUsername, token: table.user.factorioToken })
		.from(table.user)
		.where(eq(table.user.id, list.owner))
		.get();
	const problems = snapshotProblems(mods, list.factorioVersion);
	if (!release) problems.push(`No Factorio ${list.factorioVersion} headless release is available`);
	if (
		mods.some((mod) => mod.enabled && !mod.icebox && !isBundledMod(mod.name)) &&
		(!owner?.username || !owner.token)
	)
		problems.push('The list owner needs a Factorio API key in account settings to download mods');
	return {
		kind: 'server_setup_inspection' as const,
		listId: list.id,
		listName: list.name,
		factorioVersion: list.factorioVersion,
		enabledMods: mods.filter((mod) => mod.enabled && !mod.icebox).length,
		release: release ? { branch: release.branch, version: release.version } : null,
		problems
	};
}

async function saveJob(serverId: string, job: Job) {
	await db
		.update(table.serverProvisionJob)
		.set({ body: JSON.stringify(job) })
		.where(eq(table.serverProvisionJob.serverId, serverId));
	publishActivity({
		scope: 'server',
		targetId: serverId,
		task: 'setup',
		state: job.status === 'failed' ? 'error' : job.status,
		message: job.error ?? stageMessage[job.stage],
		completed: job.completed,
		total: job.total
	});
}

async function loadJob(serverId: string) {
	const row = await db
		.select()
		.from(table.serverProvisionJob)
		.where(eq(table.serverProvisionJob.serverId, serverId))
		.get();
	return row ? jobSchema.parse(JSON.parse(row.body)) : null;
}

async function requireJob(userId: string, listId: string, serverId: string) {
	await requireList(userId, listId);
	const job = await loadJob(serverId);
	if (!job || job.userId !== userId || job.listId !== listId)
		throw new ServerError(404, 'Server setup not found');
	return job;
}

export async function serverSetupStatus(userId: string, listId: string, serverId: string) {
	const job = await requireJob(userId, listId, serverId);
	if (job.status === 'running' && !serverTask(serverId)) {
		job.status = 'failed';
		job.error = 'Setup was interrupted. Retry to continue on this server.';
		await saveJob(serverId, job);
	}
	return publicStatus(serverId, job);
}

async function runSetup(server: table.ManagedServer, job: Job) {
	const stage = async (name: Job['stage']) => {
		job.stage = name;
		await saveJob(server.id, job);
	};
	job.completed = 0;
	await stage('creating');
	await initializeServer(server);
	const owner = await db
		.select({ username: table.user.factorioUsername, token: table.user.factorioToken })
		.from(table.user)
		.where(eq(table.user.id, job.ownerId))
		.get();
	if (
		job.mods.some((mod) => mod.enabled && !mod.icebox && !isBundledMod(mod.name)) &&
		(!owner?.username || !owner.token)
	)
		throw new Error('The list owner needs a Factorio API key in account settings');
	await updateServerConfig(server, {
		account: { username: owner?.username ?? '', token: owner?.token ?? '' }
	});
	await stage('version');
	const matching = await matchingRelease(job.factorioVersion);
	const release = job.release
		? {
				...job.release,
				source:
					matching?.branch === job.release.branch && matching.version === job.release.version
						? matching.source
						: null
			}
		: matching;
	if (!release) throw new Error(`No Factorio ${job.factorioVersion} headless release is available`);
	job.release = { branch: release.branch, version: release.version };
	await saveJob(server.id, job);
	const target = join(server.directory, 'versions', release.branch, release.version);
	const installed =
		(await serverVersions(server)).installed[release.branch]?.includes(release.version) &&
		Boolean(await stat(join(target, 'data', 'base', 'info.json')).catch(() => null));
	if (!installed && release.source) {
		const versionsDirectory = join(server.directory, 'versions', release.branch);
		await mkdir(versionsDirectory, { recursive: true });
		const staging = join(versionsDirectory, `.copy-${randomUUID()}`);
		await rm(target, { recursive: true, force: true });
		try {
			await cp(join(release.source, 'versions', release.branch, release.version), staging, {
				recursive: true,
				force: false,
				errorOnExist: true
			});
			await rename(staging, target);
		} finally {
			await rm(staging, { recursive: true, force: true });
		}
	} else if (!installed) {
		await rm(target, { recursive: true, force: true });
		await downloadVersion(server, release.branch, release.version, (message, percent) => {
			publishActivity({
				scope: 'server',
				targetId: server.id,
				task: 'setup',
				state: 'running',
				message,
				completed: percent,
				total: 100
			});
		});
	}
	await selectVersion(server, release.branch, release.version);
	await stage('mods');
	const [current, inventory] = await Promise.all([
		serverMods(server),
		serverModInventory(server, true)
	]);
	const plan = planServerMods(
		job.mods,
		{
			mods: current.mods,
			installed: Object.assign({}, ...inventory.installed),
			unpacked: inventory.unpacked,
			bundled: inventory.bundled,
			factorioVersion: release.version
		},
		job.factorioVersion
	);
	if (plan.problems.length) throw new Error(plan.problems.join('; '));
	job.total = plan.changes.length + 2;
	for (const change of plan.changes) {
		if (change.kind === 'install') {
			await downloadMod(server, change.name, change.version);
			await installMod(server, change.name, change.version);
		}
		await toggleMod(server, change.name, change.kind !== 'disable');
		job.completed++;
		await saveJob(server.id, job);
	}
	const [finalMods, finalInventory] = await Promise.all([
		serverMods(server),
		serverModInventory(server, true)
	]);
	const remaining = planServerMods(
		job.mods,
		{
			mods: finalMods.mods,
			installed: Object.assign({}, ...finalInventory.installed),
			unpacked: finalInventory.unpacked,
			bundled: finalInventory.bundled,
			factorioVersion: release.version
		},
		job.factorioVersion
	);
	if (remaining.problems.length || remaining.changes.length)
		throw new Error(
			`Mod setup did not verify: ${[...remaining.problems, ...remaining.changes.map((c) => c.name)].join(', ')}`
		);
	await stage('save');
	if (!(await stat(savePath(server, job.saveName)).catch(() => null)))
		await createSave(server, job.saveName);
	await updateServerConfig(server, { save: job.saveName });
	job.completed++;
	await saveJob(server.id, job);
	if (job.startRequested) {
		await stage('starting');
		await startFactorio(server);
		if (!(await processState(server)).running)
			throw new Error('Factorio did not remain running. Check the server console.');
	}
	job.completed++;
	job.stage = 'ready';
	job.status = 'done';
	job.error = null;
	await saveJob(server.id, job);
}

function launch(server: table.ManagedServer, job: Job, release: () => void) {
	void (async () => {
		try {
			await runSetup(server, job);
		} catch (cause) {
			job.status = 'failed';
			job.error = `${job.stage}: ${cause instanceof Error ? cause.message : 'unknown error'}`;
			await saveJob(server.id, job).catch(() => undefined);
		} finally {
			release();
		}
	})();
}

function serverIdForRequest(userId: string, listId: string, requestId: string) {
	if (!requestId || requestId.length > 200) throw new ServerError(400, 'Invalid setup request');
	return `list-${createHash('sha256')
		.update(JSON.stringify([userId, listId, requestId]))
		.digest('hex')
		.slice(0, 24)}`;
}

export async function serverSetupForRequest(userId: string, listId: string, requestId: string) {
	await requireList(userId, listId);
	const serverId = serverIdForRequest(userId, listId, requestId);
	return (await loadJob(serverId)) ? serverSetupStatus(userId, listId, serverId) : null;
}

export async function createServerFromList(
	userId: string,
	listId: string,
	requestId: string,
	input: { name?: string; saveName?: string; start?: boolean } = {}
) {
	const list = await requireList(userId, listId);
	const serverId = serverIdForRequest(userId, listId, requestId);
	const existing = await loadJob(serverId);
	if (existing) return serverSetupStatus(userId, listId, serverId);
	const name = (input.name?.trim() || list.name).slice(0, 80);
	const saveName = input.saveName?.trim() || 'world.zip';
	if (!name || saveName.length > 100 || !safeFileName(saveName) || !saveName.endsWith('.zip'))
		throw new ServerError(400, 'Choose a valid server and save name');
	const mods = await snapshotMods(listId);
	const problems = snapshotProblems(mods, list.factorioVersion);
	if (problems.length) throw new ServerError(409, problems.join('; '));
	const owner = await db
		.select({ username: table.user.factorioUsername, token: table.user.factorioToken })
		.from(table.user)
		.where(eq(table.user.id, list.owner))
		.get();
	if (
		mods.some((mod) => mod.enabled && !mod.icebox && !isBundledMod(mod.name)) &&
		(!owner?.username || !owner.token)
	)
		throw new ServerError(409, 'The list owner needs a Factorio API key in account settings');
	const selectedRelease = await matchingRelease(list.factorioVersion);
	if (!selectedRelease)
		throw new ServerError(409, `No Factorio ${list.factorioVersion} headless release is available`);
	const job: Job = {
		userId,
		listId,
		ownerId: list.owner,
		listName: list.name,
		factorioVersion: list.factorioVersion,
		name,
		saveName,
		startRequested: input.start === true,
		mods,
		release: { branch: selectedRelease.branch, version: selectedRelease.version },
		status: 'running',
		stage: 'creating',
		error: null,
		completed: 0,
		total: mods.filter((m) => m.enabled && !m.icebox).length + 2
	};
	const directory = join(
		env.FACMANDU_SERVER_DIRECTORY || join(homedir(), '.local/share/facmandu/servers'),
		serverId
	);
	const release = reserveServer(serverId, 'Setting up server');
	if (!release) throw new ServerError(409, 'Server setup already running');
	let handedOff = false;
	try {
		let server: table.ManagedServer | null = null;
		for (let attempt = 0; attempt < 5 && !server; attempt++) {
			const ports = await allocateServerPorts({});
			const candidate = { id: serverId, name, directory, ...ports, selectedModlist: listId };
			server = await db.transaction(async (tx) => {
				const rows = await tx
					.insert(table.managedServer)
					.values(candidate)
					.onConflictDoNothing()
					.returning();
				if (!rows.length) return null;
				await tx.insert(table.serverProvisionJob).values({ serverId, body: JSON.stringify(job) });
				return rows[0] ?? null;
			});
			if (!server && (await loadJob(serverId))) return serverSetupStatus(userId, listId, serverId);
		}
		if (!server) throw new ServerError(409, 'Could not assign server ports');
		launch(server, job, release);
		handedOff = true;
		return publicStatus(serverId, job);
	} finally {
		if (!handedOff) release();
	}
}

export async function retryServerSetup(userId: string, listId: string, serverId: string) {
	const job = await requireJob(userId, listId, serverId);
	if (job.status === 'done') return publicStatus(serverId, job);
	if (job.status === 'running' && serverTask(serverId)) return publicStatus(serverId, job);
	const server = await db
		.select()
		.from(table.managedServer)
		.where(eq(table.managedServer.id, serverId))
		.get();
	if (!server) throw new ServerError(404, 'Server setup not found');
	if ((await processState(server)).running) {
		if (job.startRequested && job.stage === 'starting') {
			const config = await serverConfig(server);
			if (
				config.save !== job.saveName ||
				!(await stat(savePath(server, job.saveName)).catch(() => null))
			)
				throw new ServerError(409, 'The running server no longer has the prepared save');
			job.status = 'done';
			job.stage = 'ready';
			job.error = null;
			await saveJob(serverId, job);
			return publicStatus(serverId, job);
		}
		throw new ServerError(409, 'This server is running. Stop it before retrying setup.');
	}
	const release = reserveServer(serverId, 'Setting up server');
	if (!release) return publicStatus(serverId, job);
	job.status = 'running';
	job.error = null;
	try {
		await saveJob(serverId, job);
	} catch (cause) {
		release();
		throw cause;
	}
	launch(server, job, release);
	return publicStatus(serverId, job);
}
