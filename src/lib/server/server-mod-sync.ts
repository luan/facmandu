import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { publishActivity } from '$lib/server/activity';
import { db, userHasModlistAccess } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { type ModChange, planServerMods } from '$lib/server/server-mod-plan';
import { reserveServer, serverTask } from '$lib/server/server-tasks';
import { requireServer } from '$lib/server/servers';
import type { ManagedServer } from './db/schema';
import {
	downloadMod,
	installMod,
	serverModInventory,
	serverMods as serverModsOnDisk,
	toggleMod
} from './server-mods';
import { serverStatus } from './server-process';

const jobSchema = z.object({
	id: z.string(),
	serverId: z.string(),
	userId: z.string(),
	listId: z.string(),
	status: z.enum(['running', 'done', 'failed']),
	completed: z.number(),
	total: z.number(),
	current: z.string(),
	error: z.string().nullable()
});
export type ModSyncJob = z.infer<typeof jobSchema>;
let recovery: Promise<void> | undefined;
// Retain terminal outcomes through a database outage; reads retry persistence without replaying mutations.
const unpersistedJobs = new Map<string, ModSyncJob>();

function reportJob(job: ModSyncJob) {
	publishActivity({
		scope: 'server',
		targetId: job.serverId,
		state: job.status === 'failed' ? 'error' : job.status,
		message:
			job.error ||
			job.current ||
			(job.status === 'done' ? 'Mod list applied' : 'Preparing mod update'),
		completed: job.completed,
		total: job.total
	});
}

async function saveJob(job: ModSyncJob) {
	await db
		.insert(table.serverJob)
		.values({ serverId: job.serverId, body: JSON.stringify(job) })
		.onConflictDoUpdate({ target: table.serverJob.serverId, set: { body: JSON.stringify(job) } });
	reportJob(job);
}

export function recoverInterruptedJobs(): Promise<void> {
	recovery ??= (async () => {
		for (const row of await db.select().from(table.serverJob)) {
			const job = jobSchema.parse(JSON.parse(row.body));
			if (job.status !== 'running' || serverTask(job.serverId)) continue;
			await saveJob({
				...job,
				status: 'failed',
				error: 'Interrupted by an app restart. Review the current server state before retrying.'
			});
		}
	})().catch((cause: unknown) => {
		recovery = undefined;
		throw cause;
	});
	return recovery;
}

export async function modSyncJob(serverId: string): Promise<ModSyncJob | null> {
	await recoverInterruptedJobs();
	const unpersisted = unpersistedJobs.get(serverId);
	if (unpersisted) {
		try {
			await saveJob(unpersisted);
			if (unpersistedJobs.get(serverId) === unpersisted) unpersistedJobs.delete(serverId);
		} catch {
			// The completed operation remains visible even when its status cannot yet be saved.
		}
		return { ...unpersisted };
	}
	const row = await db
		.select()
		.from(table.serverJob)
		.where(eq(table.serverJob.serverId, serverId))
		.get();
	if (!row) return null;
	const job = jobSchema.parse(JSON.parse(row.body));
	return job;
}

export async function loadModSyncPlan(
	connection: ManagedServer,
	userId: string,
	listId: string,
	serverMods?: { name: string; enabled: boolean; version?: string }[],
	fresh = false
) {
	if (!(await userHasModlistAccess(userId, listId))) return null;
	const [list, mods, server, inventory, status] = await Promise.all([
		db
			.select({
				id: table.modList.id,
				name: table.modList.name,
				factorioVersion: table.modList.factorioVersion
			})
			.from(table.modList)
			.where(eq(table.modList.id, listId))
			.get(),
		db
			.select({
				name: table.mod.name,
				enabled: table.mod.enabled,
				icebox: table.mod.icebox,
				version: table.mod.version,
				dependencies: table.mod.dependencies,
				factorioVersion: table.mod.factorioVersion
			})
			.from(table.mod)
			.where(eq(table.mod.modlist, listId)),
		serverMods ? Promise.resolve({ mods: serverMods }) : serverModsOnDisk(connection),
		serverModInventory(connection, fresh),
		serverStatus(connection)
	]);
	if (!list) return null;
	const plan = planServerMods(
		mods,
		{
			mods: server.mods,
			installed: Object.assign({}, ...(inventory.installed ?? [])),
			unpacked: inventory.unpacked,
			bundled: inventory.bundled,
			factorioVersion: status.version.version
		},
		list.factorioVersion
	);
	return {
		list,
		...plan,
		hash: createHash('sha256').update(`${connection.id}:${plan.hash}`).digest('hex')
	};
}

async function applyChange(server: ManagedServer, change: ModChange): Promise<void> {
	if (change.kind === 'install') {
		await downloadMod(server, change.name, change.version);
		await installMod(server, change.name, change.version);
	}
	await toggleMod(server, change.name, change.kind !== 'disable');
}

async function verifyChanges(server: ManagedServer, changes: ModChange[]) {
	if (!changes.length) return;
	const [list, inventory] = await Promise.all([
		serverModsOnDisk(server),
		serverModInventory(server, true)
	]);
	const installed: Record<string, string[]> = Object.assign({}, ...(inventory.installed ?? []));
	for (const change of changes) {
		const actual = list.mods.find((mod) => mod.name === change.name);
		const versions = installed[change.name];
		if (
			actual?.enabled !== (change.kind !== 'disable') ||
			(change.kind === 'install' &&
				(versions?.length !== 1 ||
					versions[0] !== change.version ||
					(actual.version && actual.version !== change.version)))
		)
			throw new Error(
				`The server did not retain the reviewed change to ${change.name}. Review its current state before retrying.`
			);
	}
}

export async function startModSync(
	server: ManagedServer,
	userId: string,
	listId: string,
	reviewedHash: string
) {
	await recoverInterruptedJobs();
	// One app process owns jobs. Use a database lease before running multiple app processes.
	const release = reserveServer(server.id, 'Applying mod list');
	if (!release) return { error: `${serverTask(server.id)}. Wait for this server task to finish.` };
	let handedOff = false;
	try {
		server = await requireServer(userId, server.id);
		if ((await modSyncJob(server.id))?.status === 'running')
			return { error: 'A mod update is already running on this server' };
		const plan = await loadModSyncPlan(server, userId, listId, undefined, true);
		if (!plan) return { error: 'Mod list not found or not shared with you' };
		if (plan.hash !== reviewedHash)
			return { error: 'The list or server changed. Review the changes again.' };
		if (plan.problems.length) return { error: 'Resolve the list issues before applying it' };
		const status = await serverStatus(server);
		if (status.running) return { error: 'Stop the server before applying a mod list' };

		const job: ModSyncJob = {
			id: randomUUID(),
			serverId: server.id,
			userId,
			listId,
			status: 'running',
			completed: 0,
			total: plan.changes.length,
			current: '',
			error: null
		};
		await saveJob(job);
		unpersistedJobs.delete(server.id);
		handedOff = true;
		void (async () => {
			try {
				for (const change of plan.changes) {
					job.current = `${change.kind} ${change.name}`;
					await saveJob(job);
					await applyChange(server, change);
					job.completed++;
				}
				job.current = 'Verifying installed versions and enabled mods';
				await saveJob(job);
				await verifyChanges(server, plan.changes);
				await db
					.update(table.managedServer)
					// A reviewed snapshot can finish after its source list was deleted.
					.set({
						selectedModlist: sql`(SELECT id FROM ${table.modList} WHERE ${table.modList.id} = ${listId})`
					})
					.where(eq(table.managedServer.id, server.id));
				job.status = 'done';
				job.current = '';
			} catch (cause) {
				job.status = 'failed';
				job.error = `${job.current} failed: ${cause instanceof Error ? cause.message : 'unknown error'}`;
			}
			try {
				await saveJob(job);
			} catch (cause) {
				unpersistedJobs.set(server.id, { ...job });
				reportJob(job);
				console.error('Could not persist completed mod update; retaining its outcome:', cause);
			}
		})()
			.catch((cause: unknown) => console.error('Could not persist mod update:', cause))
			.finally(release);
		return { job: { ...job } };
	} finally {
		if (!handedOff) release();
	}
}
