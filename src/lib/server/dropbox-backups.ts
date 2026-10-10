import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { cloudSaveLimit, dropboxContentHash, validateCloudSave } from '../dropbox-saves';
import type { ManagedServer } from './db/schema';
import { dropboxAccess, dropboxRequest, requireDropboxResponse } from './dropbox';
import { ServerError, safeFileName, serverConfig, updateServerConfig } from './server-files';
import { requireStopped } from './server-process';
import { savePath, serverSaves } from './server-saves';

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
async function readStableSave(server: ManagedServer, name: string) {
	const path = savePath(server, name);
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
async function publishSave(server: ManagedServer, name: string, bytes: Uint8Array) {
	const target = savePath(server, name);
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
// Initial cloud transfers require a stopped server. Add live checkpoints only after
// the same restore guarantees have been verified with asynchronous RCON saves.
export async function backupToDropbox(server: ManagedServer, userId: string) {
	await requireStopped(server);
	const access = await dropboxAccess(userId);
	const source = await currentSave(server);
	const bytes = await readStableSave(server, source);
	const name = snapshotName(source);
	await publishSave(server, name, bytes);
	const hash = dropboxContentHash(bytes);
	const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
		method: 'POST',
		redirect: 'error',
		headers: {
			Authorization: `Bearer ${access}`,
			'Content-Type': 'application/octet-stream',
			'Dropbox-API-Arg': JSON.stringify({
				path: `${folder(server)}/${name}`,
				mode: 'add',
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
			'Dropbox backup integrity check failed. The local snapshot was kept.'
		);
	return { source, backup: name };
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
		path: choice.path_lower
	});
	await requireDropboxResponse(metadataResponse);
	const current = scopedFile(server, cloudFileSchema.parse(await metadataResponse.json()));
	if (
		current.rev !== choice.rev ||
		current.content_hash !== choice.content_hash ||
		current.size !== choice.size
	)
		throw new ServerError(409, 'This cloud backup changed. Refresh and choose it again.');
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
