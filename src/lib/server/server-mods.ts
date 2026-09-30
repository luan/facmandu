import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import { modArchive } from './mod-downloads';
import { validModName } from './mod-names';
import { getPortalMod } from './portal-cache';
import { readJson, ServerError, serverConfig, versionPattern, writeJson } from './server-files';
import { executable, requireStopped } from './server-process';

const modListSchema = z.object({
	mods: z.array(
		z.object({ name: z.string(), enabled: z.boolean(), version: z.string().optional() })
	)
});
export async function serverMods(server: ManagedServer) {
	return modListSchema.parse(await readJson(join(server.directory, 'mods', 'mod-list.json')));
}
export type ModInventory = {
	available: Record<string, string[]>[];
	installed: Record<string, string[]>[];
	unpacked: Record<string, string[]>;
	bundled: Record<string, { version: string; dependencies: string[] }>;
};
export async function serverModInventory(
	server: ManagedServer,
	_fresh = false
): Promise<ModInventory> {
	const installed: Record<string, string[]> = {},
		available: Record<string, string[]> = {},
		unpacked: Record<string, string[]> = {},
		bundled: ModInventory['bundled'] = {};
	for (const [folder, result] of [
		['mods', installed],
		['downloads/mods', available]
	] as const) {
		const directory = join(server.directory, folder);
		for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
			const match = /^(.+)_(\d+\.\d+\.\d+)\.zip$/u.exec(entry.name);
			if (entry.isFile() && match?.[1] && match[2] && validModName(match[1]))
				result[match[1]] = [...(result[match[1]] ?? []), match[2]];
			if (folder === 'mods' && entry.isDirectory()) {
				const info = z
					.object({ name: z.string(), version: z.string() })
					.safeParse(await readJson(join(directory, entry.name, 'info.json')).catch(() => null));
				if (info.success) {
					installed[info.data.name] = [...(installed[info.data.name] ?? []), info.data.version];
					unpacked[info.data.name] = [...(unpacked[info.data.name] ?? []), info.data.version];
				}
			}
		}
	}
	const binary = await executable(server).catch(() => null);
	if (binary) {
		const data = join(binary, '..', '..', '..', 'data');
		for (const entry of await readdir(data, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === 'core') continue;
			const info = z
				.object({
					name: z.string(),
					version: z.string(),
					dependencies: z.array(z.string()).default([])
				})
				.safeParse(await readJson(join(data, entry.name, 'info.json')).catch(() => null));
			if (info.success)
				bundled[info.data.name] = {
					version: info.data.version,
					dependencies: info.data.dependencies
				};
		}
	}
	return {
		installed: [installed],
		available: [available],
		unpacked,
		bundled
	};
}
export async function downloadMod(server: ManagedServer, name: string, version: string) {
	if (!validModName(name) || !versionPattern.test(version))
		throw new ServerError(400, 'Invalid mod release');
	const { data } = await getPortalMod(name);
	const release = data?.releases.find((release) => release.version === version);
	if (!release) throw new ServerError(404, 'Mod release not found');
	const config = await serverConfig(server);
	const archive = await modArchive(
		name,
		release,
		config.account.username && config.account.token ? config.account : null
	);
	const directory = join(server.directory, 'downloads', 'mods');
	await mkdir(directory, { recursive: true });
	const target = join(directory, `${name}_${version}.zip`),
		temporary = `${target}.${randomUUID()}.tmp`;
	await copyFile(archive.path, temporary);
	await rename(temporary, target);
}
export async function installMod(server: ManagedServer, name: string, version: string) {
	await requireStopped(server);
	if (!validModName(name) || !versionPattern.test(version))
		throw new ServerError(400, 'Invalid mod release');
	const inventory = await serverModInventory(server);
	if (inventory.unpacked[name]?.length)
		throw new ServerError(409, 'Move the unpacked development mod before replacing its version');
	const filename = `${name}_${version}.zip`,
		target = join(server.directory, 'mods', filename),
		temporary = `${target}.${randomUUID()}.tmp`;
	await copyFile(join(server.directory, 'downloads', 'mods', filename), temporary);
	await rename(temporary, target);
	const list = await serverMods(server);
	const existing = list.mods.find((mod) => mod.name === name);
	if (existing) existing.version = version;
	else list.mods.push({ name, version, enabled: false });
	await writeJson(join(server.directory, 'mods', 'mod-list.json'), list);
	for (const old of inventory.installed[0]?.[name] ?? []) {
		if (old === version) continue;
		await rename(
			join(server.directory, 'mods', `${name}_${old}.zip`),
			join(server.directory, 'downloads', 'mods', `${name}_${old}.zip`)
		);
	}
}
export async function toggleMod(server: ManagedServer, name: string, enabled: boolean) {
	await requireStopped(server);
	if (!validModName(name) || (name === 'base' && !enabled))
		throw new ServerError(400, 'Invalid mod');
	if (enabled) {
		const inventory = await serverModInventory(server);
		if (!inventory.bundled[name] && !inventory.installed.some((mods) => mods[name]?.length))
			throw new ServerError(409, 'Install the mod before enabling it');
	}
	const list = await serverMods(server);
	const existing = list.mods.find((mod) => mod.name === name);
	if (existing) existing.enabled = enabled;
	else list.mods.push({ name, enabled });
	await writeJson(join(server.directory, 'mods', 'mod-list.json'), list);
}
export async function removeMod(
	server: ManagedServer,
	name: string,
	version: string,
	fromCache: boolean
) {
	await requireStopped(server);
	if (!validModName(name) || !versionPattern.test(version))
		throw new ServerError(400, 'Invalid mod release');
	if (!fromCache && (await serverMods(server)).mods.some((mod) => mod.name === name && mod.enabled))
		throw new ServerError(409, 'Disable the mod first');
	await unlink(
		join(server.directory, fromCache ? 'downloads/mods' : 'mods', `${name}_${version}.zip`)
	);
}
