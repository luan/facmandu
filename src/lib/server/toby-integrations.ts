import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import taskList from '../../../factorio-mod/integrations/task-list.lua?raw';
import type { ManagedServer } from './db/schema';
import { ServerError } from './server-files';
import { installMod, serverModInventory, toggleMod } from './server-mods';
import { requireStopped } from './server-process';

export const tobyIntegrations = {
	TaskList: { from: '0.6.0', version: '0.6.1', source: taskList }
} as const;
export type TobyIntegration = keyof typeof tobyIntegrations;

export async function tobyIntegrationArchive(server: ManagedServer, name: TobyIntegration) {
	const adapter = tobyIntegrations[name];
	const inventory = await serverModInventory(server);
	if (inventory.unpacked[name]?.length)
		throw new ServerError(
			409,
			'Move the unpacked development mod before installing its Toby adapter'
		);
	// Only the reviewed upstream version is patched. Add later versions after native compatibility tests.
	const original = join(server.directory, 'mods', `${name}_${adapter.from}.zip`);
	const retained = join(server.directory, 'downloads', 'mods', `${name}_${adapter.from}.zip`);
	const path = await stat(original)
		.then(() => original)
		.catch(() => retained);
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
		'Facmandu adds facmandu-toby.lua and a require in control.lua. Original source and license are retained. This adapter adds shared force task APIs; it does not grant items, research or editor permissions.\nSource: https://github.com/luan/facmandu/tree/main/factorio-mod/integrations\n'
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
	const version = tobyIntegrations[name].version;
	const directory = join(server.directory, 'downloads', 'mods');
	await mkdir(directory, { recursive: true });
	const path = join(directory, `${name}_${version}.zip`);
	await writeFile(`${path}.tmp`, archive, { mode: 0o600 });
	await rename(`${path}.tmp`, path);
	await installMod(server, name, version);
	await toggleMod(server, name, true);
}
