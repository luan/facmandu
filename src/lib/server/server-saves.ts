import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	appendFile,
	copyFile,
	link,
	open,
	readdir,
	rename,
	rm,
	stat,
	unlink,
	writeFile
} from 'node:fs/promises';
import { join } from 'node:path';
import { type WorldGenerationSettings, worldGenerationSchema } from '../map-generation';
import type { ManagedServer } from './db/schema';
import { withNativeMapGeneration } from './map-generation-native';
import { ServerError, safeFileName, serverConfig, updateServerConfig } from './server-files';
import { requireStopped, run } from './server-process';
export async function serverSaves(server: ManagedServer) {
	const entries = await readdir(join(server.directory, 'saves'));
	return Promise.all(
		entries
			.filter((name) => name.endsWith('.zip'))
			.map(async (name) => {
				const file = await stat(join(server.directory, 'saves', name));
				return { name, size: file.size, modTime: file.mtime.toISOString() };
			})
	);
}
export function savePath(server: ManagedServer, name: string) {
	if (!safeFileName(name) || !name.endsWith('.zip'))
		throw new ServerError(400, 'Invalid save name');
	return join(server.directory, 'saves', name);
}
// A named live save is complete only after ZIP's trailing central directory is readable.
// ZIP64 saves need a larger parser if worlds outgrow the classic ZIP directory limits.
export async function completeSaveZip(path: string): Promise<boolean> {
	const file = await open(path, 'r').catch((cause: unknown) => {
		if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
		throw cause;
	});
	if (!file) return false;
	try {
		const { size } = await file.stat();
		if (size < 22) return false;
		const length = Math.min(size, 65_557);
		const tail = Buffer.alloc(length);
		const { bytesRead } = await file.read(tail, 0, length, size - length);
		if (bytesRead !== length) return false;
		for (let offset = length - 22; offset >= 0; offset--) {
			if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
			if (offset + 22 + tail.readUInt16LE(offset + 20) !== length) continue;
			const entries = tail.readUInt16LE(offset + 10);
			const centralSize = tail.readUInt32LE(offset + 12);
			const centralOffset = tail.readUInt32LE(offset + 16);
			if (!entries || centralOffset + centralSize !== size - length + offset) continue;
			const signature = Buffer.alloc(4);
			const central = await file.read(signature, 0, 4, centralOffset);
			if (central.bytesRead !== 4 || signature.readUInt32LE(0) !== 0x02014b50) continue;
			return (await file.stat()).size === size;
		}
		return false;
	} finally {
		await file.close();
	}
}

export async function renameSave(server: ManagedServer, name: string, newName: string) {
	const source = savePath(server, name),
		target = savePath(server, newName);
	await requireStopped(server);
	try {
		await stat(source);
	} catch (cause) {
		if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
			throw new ServerError(404, 'Save not found');
		throw cause;
	}
	if (name === newName) return;
	try {
		await link(source, target);
	} catch (cause) {
		if (cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')
			throw new ServerError(409, 'A save with that name already exists');
		throw cause;
	}
	try {
		if ((await serverConfig(server)).save === name)
			await updateServerConfig(server, { save: newName });
	} catch (cause) {
		await unlink(target);
		throw cause;
	}
	await unlink(source);
}

export async function prepareStartupSave(server: ManagedServer) {
	const config = await serverConfig(server);
	const saves = (await serverSaves(server)).toSorted((a, b) => b.modTime.localeCompare(a.modTime));
	const autosave = saves.find(
		(save) =>
			/^_autosave\d+\.zip$/u.test(save.name) && Date.parse(save.modTime) > config.autosaveAfter
	);
	const primary =
		config.save ||
		saves.find((save) => !/^_autosave\d+\.zip$/u.test(save.name))?.name ||
		(autosave ? 'world.zip' : '');
	if (!primary) throw new ServerError(409, 'Create or upload a save first');
	const path = savePath(server, primary);
	const existing = saves.find((save) => save.name === primary);
	if (config.save && !existing) throw new ServerError(404, 'Selected save not found');
	if (config.resumeAutosave && autosave && (!existing || autosave.modTime > existing.modTime)) {
		const source = savePath(server, autosave.name);
		if (!(await completeSaveZip(source)))
			throw new ServerError(
				409,
				'The latest autosave is incomplete. Select a different save to recover.'
			);
		// Launch the recovered bytes under the world's name so Factorio saves back to that name.
		// Keep the autosave intact and publish only a complete copy.
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await copyFile(source, temporary);
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	await stat(path);
	await updateServerConfig(server, { save: primary });
	return path;
}

export async function deleteSave(server: ManagedServer, name: string) {
	await requireStopped(server);
	if ((await serverConfig(server)).save === name)
		throw new ServerError(409, 'Select another save first');
	await unlink(savePath(server, name));
}
export async function uploadSave(server: ManagedServer, file: File) {
	if (file.size < 4 || file.size > 100 * 1024 * 1024)
		throw new ServerError(400, 'Save must be between 1 byte and 100 MB');
	const target = savePath(server, file.name);
	const bytes = Buffer.from(await file.arrayBuffer());
	if (bytes.readUInt32LE(0) !== 0x04034b50) throw new ServerError(400, 'Choose a ZIP save file');
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
		await link(temporary, target);
	} catch (cause) {
		if (cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')
			throw new ServerError(409, 'A save with that name already exists');
		throw cause;
	} finally {
		await rm(temporary, { force: true });
	}
}
export async function createSave(
	server: ManagedServer,
	name: string,
	settings: WorldGenerationSettings = {}
) {
	const parsed = worldGenerationSchema.safeParse(settings);
	if (!parsed.success) throw new ServerError(400, 'Invalid map settings');
	const path = savePath(server, name);
	if (await stat(path).catch(() => null))
		throw new ServerError(409, 'A save with that name already exists');
	const temporary = join(server.directory, 'downloads', `${randomUUID()}.zip`);
	try {
		try {
			await withNativeMapGeneration(server, parsed.data, ({ binary, args }) =>
				run(binary, [...args, '--create', temporary], {
					timeout: 180000,
					maxBuffer: 1024 * 1024
				})
			);
		} catch (cause) {
			if (cause instanceof ServerError) throw cause;
			const output =
				cause instanceof Error && 'stdout' in cause && typeof cause.stdout === 'string'
					? cause.stdout
					: '';
			await appendFile(
				join(server.directory, 'logs', 'server.log'),
				`\nSave creation failed: ${name}\n${output}\n`
			);
			throw new ServerError(500, 'Could not create save. Check the console for details.');
		}
		try {
			await link(temporary, path);
		} catch (cause) {
			if (cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')
				throw new ServerError(409, 'A save with that name already exists');
			throw cause;
		}
	} finally {
		await rm(temporary, { force: true });
	}
}
export const readSave = (server: ManagedServer, name: string) =>
	createReadStream(savePath(server, name));
