import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import factoryPlanner from '../../../factorio-mod/integrations/factory-planner.lua?raw';
import taskList from '../../../factorio-mod/integrations/task-list.lua?raw';
import type { ManagedServer } from './db/schema';
import { ServerError } from './server-files';
import { installMod, serverModInventory, toggleMod } from './server-mods';
import { requireStopped } from './server-process';

export const tobyIntegrations = {
	TaskList: { from: '0.6.0', version: '0.6.1', source: taskList, note: 'Shared force task APIs' },
	factoryplanner: {
		from: '2.1.18',
		version: '2.1.18',
		source: factoryPlanner,
		note: 'Temporary native solver calculations that preserve existing plans and selection'
	}
} as const;
export type TobyIntegration = keyof typeof tobyIntegrations;

function originalPath(server: ManagedServer, name: TobyIntegration) {
	return join(
		server.directory,
		'downloads',
		'integrations',
		`${name}_${tobyIntegrations[name].from}.zip`
	);
}
async function sourcePath(server: ManagedServer, name: TobyIntegration) {
	const filename = `${name}_${tobyIntegrations[name].from}.zip`;
	for (const path of [
		originalPath(server, name),
		join(server.directory, 'mods', filename),
		join(server.directory, 'downloads', 'mods', filename)
	]) {
		if (
			await stat(path)
				.then(() => true)
				.catch(() => false)
		)
			return path;
	}
	throw new ServerError(
		409,
		`Install the reviewed ${name} ${tobyIntegrations[name].from} source first`
	);
}

export async function tobyIntegrationArchive(server: ManagedServer, name: TobyIntegration) {
	const adapter = tobyIntegrations[name];
	const inventory = await serverModInventory(server);
	if (inventory.unpacked[name]?.length)
		throw new ServerError(
			409,
			'Move the unpacked development mod before installing its Toby adapter'
		);
	// Only the reviewed upstream version is patched. Add later versions after native compatibility tests.
	const path = await sourcePath(server, name);
	const size = (await stat(path)).size;
	if (size > 64 * 1024 * 1024)
		throw new ServerError(409, 'Integration source archive is too large');
	let budget = 256 * 1024 * 1024;
	const files = unzipSync(await readFile(path), {
		filter(file) {
			budget -= file.originalSize;
			if (budget < 0) throw new ServerError(409, 'Integration source expands beyond its limit');
			return true;
		}
	});
	const folder = `${name}_${adapter.from}`;
	const encode = new TextEncoder();
	const decode = new TextDecoder('utf-8', { fatal: true });
	const metadata: unknown = JSON.parse(decode.decode(files[`${folder}/info.json`]));
	if (
		!metadata ||
		typeof metadata !== 'object' ||
		!('name' in metadata) ||
		metadata.name !== name ||
		!('version' in metadata) ||
		metadata.version !== adapter.from
	)
		throw new ServerError(409, 'Unexpected integration source version');
	const control = files[`${folder}/control.lua`];
	if (!control) throw new ServerError(409, 'Integration source is missing control.lua');
	files[`${folder}/control.lua`] = encode.encode(
		`${decode.decode(control)}\nrequire('facmandu-toby')\n`
	);
	files[`${folder}/facmandu-toby.lua`] = encode.encode(adapter.source);
	files[`${folder}/info.json`] = encode.encode(
		JSON.stringify({ ...metadata, version: adapter.version })
	);
	files[`${folder}/TOBY.md`] = encode.encode(
		`Facmandu adds facmandu-toby.lua and a require in control.lua. Original source and license are retained. ${adapter.note}. No items, research or editor permissions are granted. This is a private adapter, not an upstream release.\nSource: https://github.com/luan/facmandu/tree/main/factorio-mod/integrations\n`
	);
	return zipSync(
		Object.fromEntries(
			Object.entries(files).map(([path, data]) => [
				path.replace(`${folder}/`, `${name}_${adapter.version}/`),
				data
			])
		)
	);
}

export async function installTobyIntegration(server: ManagedServer, name: TobyIntegration) {
	await requireStopped(server);
	const archive = await tobyIntegrationArchive(server, name);
	// Preserve the reviewed source before replacing a same-version private adapter.
	const source = await sourcePath(server, name);
	const retained = originalPath(server, name);
	if (source !== retained) {
		await mkdir(join(server.directory, 'downloads', 'integrations'), { recursive: true });
		await copyFile(source, retained, constants.COPYFILE_EXCL).catch((cause: unknown) => {
			if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause;
		});
	}
	const version = tobyIntegrations[name].version;
	const directory = join(server.directory, 'downloads', 'mods');
	await mkdir(directory, { recursive: true });
	const path = join(directory, `${name}_${version}.zip`);
	await writeFile(`${path}.tmp`, archive, { mode: 0o600 });
	await rename(`${path}.tmp`, path);
	await installMod(server, name, version);
	await toggleMod(server, name, true);
}
