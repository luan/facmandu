import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import control from '../../../factorio-mod/facmandu-assistant/control.lua?raw';
import data from '../../../factorio-mod/facmandu-assistant/data.lua?raw';
import info from '../../../factorio-mod/facmandu-assistant/info.json';
import readme from '../../../factorio-mod/facmandu-assistant/README.md?raw';
import type { ManagedServer } from './db/schema';
import { ServerError, serverConfig } from './server-files';
import { installMod, toggleMod } from './server-mods';
import { requireStopped } from './server-process';

export const tobyModInfo = info;
export function tobyModArchive() {
	const encode = new TextEncoder();
	return zipSync(
		Object.fromEntries(
			Object.entries({
				'info.json': JSON.stringify(info),
				'control.lua': control,
				'data.lua': data,
				'README.md': readme
			}).map(([name, source]) => [`${info.name}_${info.version}/${name}`, encode.encode(source)])
		)
	);
}

export async function installTobyMod(server: ManagedServer) {
	await requireStopped(server);
	const config = await serverConfig(server);
	if (config.version?.version.split('.').slice(0, 2).join('.') !== info.factorio_version)
		throw new ServerError(409, `Toby requires Factorio ${info.factorio_version}`);
	const directory = join(server.directory, 'downloads', 'mods');
	await mkdir(directory, { recursive: true });
	const target = join(directory, `${info.name}_${info.version}.zip`);
	const temporary = `${target}.tmp`;
	await writeFile(temporary, tobyModArchive(), { mode: 0o600 });
	await rename(temporary, target);
	await installMod(server, info.name, info.version);
	await toggleMod(server, info.name, true);
}
