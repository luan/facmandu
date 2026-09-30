import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, link, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type WorldGenerationSettings, worldGenerationSchema } from '../map-generation';
import type { ManagedServer } from './db/schema';
import { withNativeMapGeneration } from './map-generation-native';
import { ServerError, safeFileName, serverConfig } from './server-files';
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
