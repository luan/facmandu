import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { cloudSaveLimit, dropboxContentHash, validateCloudSave } from '../dropbox-saves';
import { publishActivity } from './activity';
import { db } from './db';
import type { ManagedServer } from './db/schema';
import { managedServer } from './db/schema';
import { dropboxAccess, dropboxRequest, hasDropbox, requireDropboxResponse } from './dropbox';
import {
	ServerError,
	safeFileName,
	serverConfig,
	updateServerConfig,
	writeJson
} from './server-files';
import { requireStopped } from './server-process';
import { savePath, serverSaves } from './server-saves';
import { reserveServer } from './server-tasks';
import { canManageServer } from './servers';

export const cloudFileSchema = z.object({
	name: z.string().max(255),
	path_lower: z.string(),
	rev: z.string().regex(/^[0-9a-f]{9,}$/u),
	content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
	size: z.number().int().nonnegative(),
	server_modified: z.string()
});
export type CloudSave = z.infer<typeof cloudFileSchema>;
function folder(server: ManagedServer) {
	if (!/^[a-z0-9-]+$/iu.test(server.id)) throw new ServerError(400, 'Invalid server identifier');
	return `/servers/${server.id.toLowerCase()}`;
}
function scopedFile(server: ManagedServer, file: CloudSave) {
	if (
		!safeFileName(file.name) ||
		!file.name.startsWith('cloud-') ||
		!file.name.endsWith('.zip') ||
		file.path_lower !== `${folder(server)}/${file.name.toLowerCase()}`
	)
		throw new ServerError(400, 'Choose a backup belonging to this server');
	if (file.size > cloudSaveLimit)
		throw new ServerError(413, 'Cloud save exceeds the 100 MB restore limit');
	return file;
}
export async function listDropboxSaves(server: ManagedServer, access: string, cursor?: string) {
	const response = await dropboxRequest(
		access,
		cursor ? 'files/list_folder/continue' : 'files/list_folder',
		cursor ? { cursor } : { path: folder(server), limit: 100 }
	);
	if (response.status === 409 && !cursor) {
		const problem: unknown = await response.json();
		if (
			z
				.object({
					error: z.object({
						'.tag': z.literal('path'),
						path: z.object({ '.tag': z.literal('not_found') })
					})
				})
				.safeParse(problem).success
		)
			return { saves: [], cursor: null };
	}
	await requireDropboxResponse(response);
	const page = z
		.object({ entries: z.array(z.unknown()), cursor: z.string(), has_more: z.boolean() })
		.parse(await response.json());
	const saves = page.entries
		.flatMap((entry) => {
			const file = cloudFileSchema.safeParse(entry);
			if (!file.success) return [];
			try {
				return [scopedFile(server, file.data)];
			} catch {
				return [];
			}
		})
		.toSorted((a, b) => b.server_modified.localeCompare(a.server_modified));
	const current = saves.find((file) => file.name === 'cloud-current.zip');
	if (current) {
		const response = await dropboxRequest(access, 'files/list_revisions', {
			path: current.path_lower,
			mode: 'path',
			limit: 100
		});
		await requireDropboxResponse(response);
		const history = z.object({ entries: z.array(cloudFileSchema) }).parse(await response.json());
		return {
			saves: [
				...history.entries.map((file) => scopedFile(server, file)),
				...saves.filter((file) => file !== current)
			],
			cursor: page.has_more ? page.cursor : null
		};
	}
	return { saves, cursor: page.has_more ? page.cursor : null };
}
async function currentSave(server: ManagedServer) {
	const config = await serverConfig(server);
	const saves = (await serverSaves(server)).toSorted((a, b) => b.modTime.localeCompare(a.modTime));
	const primary = config.save
		? saves.find((save) => save.name === config.save)
		: saves.find((save) => !/^_autosave\d+\.zip$/u.test(save.name));
	if (config.save && !primary) throw new ServerError(404, 'Selected save not found');
	const autosave = config.resumeAutosave
		? saves.find(
				(save) =>
					/^_autosave\d+\.zip$/u.test(save.name) && Date.parse(save.modTime) > config.autosaveAfter
			)
		: undefined;
	const selected =
		autosave && (!primary || autosave.modTime > primary.modTime) ? autosave : primary;
	if (!selected) throw new ServerError(409, 'No current world to back up');
	return selected.name;
}
function readStableSave(server: ManagedServer, name: string) {
	return readStableFile(savePath(server, name));
}
async function readStableFile(path: string) {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await file.stat();
		if (!before.isFile() || before.size > cloudSaveLimit)
			throw new ServerError(413, 'Save exceeds the 100 MB cloud transfer limit');
		const bytes = await file.readFile();
		const after = await stat(path);
		if (
			before.ino !== after.ino ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			bytes.length !== before.size
		)
			throw new ServerError(409, 'Save changed while copying. Try again.');
		try {
			validateCloudSave(bytes);
		} catch {
			throw new ServerError(
				422,
				'Save is incomplete or is not a Factorio world. Existing files were preserved.'
			);
		}
		return bytes;
	} finally {
		await file.close();
	}
}
function publishSave(server: ManagedServer, name: string, bytes: Uint8Array) {
	return publishFile(savePath(server, name), bytes);
}
async function publishFile(target: string, bytes: Uint8Array) {
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
		const file = await open(temporary, 'r');
		try {
			await file.sync();
		} finally {
			await file.close();
		}
		await link(temporary, target);
		const directory = await open(dirname(target), 'r');
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	} finally {
		await rm(temporary, { force: true });
	}
}
function snapshotName(source: string, prefix = 'cloud') {
	return `${prefix}-${source
		.replace(/\.zip$/u, '')
		.replace(/[^a-z0-9_-]/giu, '-')
		.slice(0, 45)}-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}.zip`;
}
const backupStateSchema = z.object({
	source: z.string(),
	stamp: z.string(),
	revision: z.string(),
	hash: z.string()
});
const statePath = (server: ManagedServer) => join(server.directory, 'cloud-backup.json');
export async function cloudBackupState(server: ManagedServer) {
	try {
		return backupStateSchema.parse(JSON.parse(await readFile(statePath(server), 'utf8')));
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw cause;
	}
}
async function saveStamp(server: ManagedServer, source: string) {
	const file = await stat(savePath(server, source));
	return `${file.ino}:${file.size}:${file.mtimeMs}`;
}
export async function backupToDropbox(server: ManagedServer, userId: string, automatic = false) {
	const source = await currentSave(server);
	const stamp = await saveStamp(server, source);
	const previous = await cloudBackupState(server);
	if (automatic && previous?.source === source && previous.stamp === stamp)
		return { source, backup: 'cloud-current.zip', unchanged: true };
	const access = await dropboxAccess(userId);
	const bytes = await readStableSave(server, source);
	const hash = dropboxContentHash(bytes);
	const name = 'cloud-current.zip';
	const path = `${folder(server)}/${name}`;
	const metadata = await dropboxRequest(access, 'files/get_metadata', { path });
	let current: CloudSave | null = null;
	if (metadata.status === 409) {
		const problem = z
			.object({
				error: z.object({
					'.tag': z.literal('path'),
					path: z.object({ '.tag': z.literal('not_found') })
				})
			})
			.safeParse(await metadata.json());
		if (!problem.success)
			throw new ServerError(
				409,
				'Could not inspect the existing Dropbox backup. Nothing was overwritten.'
			);
	} else {
		await requireDropboxResponse(metadata);
		current = scopedFile(server, cloudFileSchema.parse(await metadata.json()));
	}
	if (current?.content_hash === hash && current.size === bytes.length) {
		await writeJson(statePath(server), { source, stamp, revision: current.rev, hash });
		return { source, backup: name, unchanged: true };
	}
	// Failed snapshots remain private; successful history belongs to Dropbox revisions.
	const recovery = join(server.directory, `cloud-pending-${hash}.zip`);
	try {
		await publishFile(recovery, bytes);
	} catch (cause) {
		if (
			(cause as NodeJS.ErrnoException).code !== 'EEXIST' ||
			dropboxContentHash(await readStableFile(recovery)) !== hash
		)
			throw cause;
	}
	const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
		method: 'POST',
		redirect: 'error',
		headers: {
			Authorization: `Bearer ${access}`,
			'Content-Type': 'application/octet-stream',
			'Dropbox-API-Arg': JSON.stringify({
				path,
				mode: current ? { '.tag': 'update', update: current.rev } : 'add',
				autorename: false,
				strict_conflict: true,
				content_hash: hash
			})
		},
		body: new Uint8Array(bytes),
		signal: AbortSignal.timeout(120_000)
	});
	await requireDropboxResponse(response);
	const uploaded = scopedFile(server, cloudFileSchema.parse(await response.json()));
	if (uploaded.name !== name || uploaded.content_hash !== hash || uploaded.size !== bytes.length)
		throw new ServerError(
			502,
			'Dropbox backup integrity check failed. The local recovery copy was kept.'
		);
	// Replace the local latest recovery only after Dropbox verified the new revision.
	await rename(recovery, join(server.directory, 'cloud-recovery.zip'));
	const directory = await open(server.directory, 'r');
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
	await writeJson(statePath(server), { source, stamp, revision: uploaded.rev, hash });
	return { source, backup: name, unchanged: false };
}
async function boundedDownload(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) throw new ServerError(502, 'Dropbox returned an empty download');
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			length += part.value.byteLength;
			if (length > cloudSaveLimit)
				throw new ServerError(413, 'Cloud save exceeds the 100 MB restore limit');
			chunks.push(part.value);
		}
	} finally {
		await reader.cancel();
	}
	return Buffer.concat(chunks, length);
}
export async function restoreFromDropbox(server: ManagedServer, userId: string, choice: CloudSave) {
	await requireStopped(server);
	scopedFile(server, choice);
	const access = await dropboxAccess(userId);
	const metadataResponse = await dropboxRequest(access, 'files/get_metadata', {
		path: `rev:${choice.rev}`
	});
	await requireDropboxResponse(metadataResponse);
	const current = scopedFile(server, cloudFileSchema.parse(await metadataResponse.json()));
	if (
		current.rev !== choice.rev ||
		current.content_hash !== choice.content_hash ||
		current.size !== choice.size
	)
		throw new ServerError(409, 'This cloud revision no longer matches. No save was replaced.');
	const response = await fetch('https://content.dropboxapi.com/2/files/download', {
		method: 'POST',
		redirect: 'error',
		headers: {
			Authorization: `Bearer ${access}`,
			'Dropbox-API-Arg': JSON.stringify({ path: `rev:${current.rev}` })
		},
		signal: AbortSignal.timeout(120_000)
	});
	await requireDropboxResponse(response);
	const downloaded = scopedFile(
		server,
		cloudFileSchema.parse(JSON.parse(response.headers.get('Dropbox-API-Result') || 'null'))
	);
	if (downloaded.rev !== current.rev || downloaded.content_hash !== current.content_hash)
		throw new ServerError(409, 'Dropbox returned a different revision. No save was replaced.');
	const bytes = await boundedDownload(response);
	if (bytes.length !== current.size || dropboxContentHash(bytes) !== current.content_hash)
		throw new ServerError(422, 'Cloud save integrity check failed. No save was replaced.');
	try {
		validateCloudSave(bytes);
	} catch {
		throw new ServerError(422, 'Cloud file is not a complete Factorio save. No save was replaced.');
	}
	await requireStopped(server);
	let backup: string | null = null;
	if ((await serverSaves(server)).length) {
		const source = await currentSave(server);
		backup = snapshotName(source, 'before-restore');
		await publishSave(server, backup, await readStableSave(server, source));
	}
	const restored = snapshotName(current.name, 'restored');
	await publishSave(server, restored, bytes);
	await updateServerConfig(server, { save: restored, resumeAutosave: false });
	return { restored, backup };
}

const sampler = globalThis as typeof globalThis & {
	__facmanduCloudTimer?: ReturnType<typeof setInterval>;
	__facmanduCloudBusy?: boolean;
};
export async function sampleDropboxBackups() {
	if (sampler.__facmanduCloudBusy) return;
	sampler.__facmanduCloudBusy = true;
	try {
		for (const server of await db.select().from(managedServer)) {
			const config = await serverConfig(server);
			if (
				!config.cloudBackup.enabled ||
				!canManageServer(config.cloudBackup.ownerId) ||
				!(await hasDropbox(config.cloudBackup.ownerId))
			)
				continue;
			const release = reserveServer(server.id, 'Backing up completed save to Dropbox');
			if (!release) continue;
			try {
				const result = await backupToDropbox(server, config.cloudBackup.ownerId, true);
				if (!result.unchanged)
					publishActivity({
						scope: 'server',
						targetId: server.id,
						task: 'cloud-save',
						state: 'done',
						message: 'Completed save backed up to Dropbox',
						completed: 1,
						total: 1
					});
			} catch (cause) {
				// A save still being written is retried; it must never replace the last verified cloud revision.
				if (
					cause instanceof ServerError &&
					[404, 409, 422].includes(cause.status) &&
					/No current world|Selected save not found|changed while copying|Save is incomplete/.test(
						cause.message
					)
				)
					continue;
				publishActivity({
					scope: 'server',
					targetId: server.id,
					task: 'cloud-save',
					state: 'error',
					message: cause instanceof Error ? cause.message : 'Automatic Dropbox backup failed',
					completed: 0,
					total: 1
				});
			} finally {
				release();
			}
		}
	} finally {
		sampler.__facmanduCloudBusy = false;
	}
}
export function startDropboxBackups() {
	if (sampler.__facmanduCloudTimer) return;
	const sample = () =>
		void sampleDropboxBackups().catch((cause) =>
			console.error('Automatic Dropbox backup failed:', cause)
		);
	sampler.__facmanduCloudTimer = setInterval(sample, 60_000);
	sampler.__facmanduCloudTimer.unref();
	sample();
}
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		if (sampler.__facmanduCloudTimer) clearInterval(sampler.__facmanduCloudTimer);
		sampler.__facmanduCloudTimer = undefined;
	});
