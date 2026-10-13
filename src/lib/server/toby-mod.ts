import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import error from '../../../assets/toby-drone/sprites/error.png?inline';
import icon from '../../../assets/toby-drone/sprites/icon.png?inline';
import idle from '../../../assets/toby-drone/sprites/idle.png?inline';
import inspecting from '../../../assets/toby-drone/sprites/inspecting.png?inline';
import shadow from '../../../assets/toby-drone/sprites/shadow.png?inline';
import speaking from '../../../assets/toby-drone/sprites/speaking.png?inline';
import success from '../../../assets/toby-drone/sprites/success.png?inline';
import thinking from '../../../assets/toby-drone/sprites/thinking.png?inline';
import working from '../../../assets/toby-drone/sprites/working.png?inline';
import control from '../../../factorio-mod/facmandu-assistant/control.lua?raw';
import data from '../../../factorio-mod/facmandu-assistant/data.lua?raw';
import drone from '../../../factorio-mod/facmandu-assistant/drone.lua?raw';
import dronePrototypes from '../../../factorio-mod/facmandu-assistant/drone-prototypes.lua?raw';
import droneVisuals from '../../../factorio-mod/facmandu-assistant/drone-visuals.lua?raw';
import info from '../../../factorio-mod/facmandu-assistant/info.json';
import locale from '../../../factorio-mod/facmandu-assistant/locale/en/toby.cfg?raw';
import readme from '../../../factorio-mod/facmandu-assistant/README.md?raw';
import references from '../../../factorio-mod/facmandu-assistant/references.lua?raw';
import type { ManagedServer } from './db/schema';
import { ServerError, serverConfig } from './server-files';
import { installMod, toggleMod } from './server-mods';
import { requireStopped } from './server-process';

export const tobyModInfo = info;
export function tobyModArchive() {
	const encode = new TextEncoder();
	return zipSync(
		Object.fromEntries([
			...Object.entries({
				'info.json': JSON.stringify(info),
				'control.lua': control,
				'data.lua': data,
				'drone.lua': drone,
				'drone-visuals.lua': droneVisuals,
				'references.lua': references,
				'drone-prototypes.lua': dronePrototypes,
				'locale/en/toby.cfg': locale,
				'README.md': readme
			}).map(
				([name, source]) => [`${info.name}_${info.version}/${name}`, encode.encode(source)] as const
			),
			...Object.entries({
				idle,
				inspecting,
				thinking,
				working,
				speaking,
				success,
				error,
				shadow,
				icon
			}).map(
				([name, source]) =>
					[
						`${info.name}_${info.version}/graphics/${name}.png`,
						// Vite embeds assets; Bun's file loader returns their absolute paths.
						new Uint8Array(
							source.startsWith('data:image/png;base64,')
								? Buffer.from(source.slice('data:image/png;base64,'.length), 'base64')
								: readFileSync(source)
						)
					] as const
			)
		])
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
