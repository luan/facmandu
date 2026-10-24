import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import dataFinalFixes from '../../../factorio-mod/facmandu-assistant/data-final-fixes.lua?raw';
import drone from '../../../factorio-mod/facmandu-assistant/drone.lua?raw';
import dronePrototypes from '../../../factorio-mod/facmandu-assistant/drone-prototypes.lua?raw';
import droneVisuals from '../../../factorio-mod/facmandu-assistant/drone-visuals.lua?raw';
import events from '../../../factorio-mod/facmandu-assistant/events.lua?raw';
import info from '../../../factorio-mod/facmandu-assistant/info.json';
import locale from '../../../factorio-mod/facmandu-assistant/locale/en/toby.cfg?raw';
import readme from '../../../factorio-mod/facmandu-assistant/README.md?raw';
import references from '../../../factorio-mod/facmandu-assistant/references.lua?raw';
import robotTrial from '../../../factorio-mod/facmandu-assistant/robot-trial.lua?raw';
import sandbox from '../../../factorio-mod/facmandu-assistant/sandbox.lua?raw';
import taskBoard from '../../../factorio-mod/facmandu-assistant/task-board.lua?raw';
import taskStore from '../../../factorio-mod/facmandu-assistant/task-store.lua?raw';
import type { ManagedServer } from './db/schema';
import territory from './factory-query/scripts/tools/territory.lua?raw';
import { ServerError, serverConfig } from './server-files';
import { installMod, toggleMod } from './server-mods';
import { requireStopped } from './server-process';

let plannerSources: Record<string, string>;
let plannerImages: Record<string, string>;
try {
	plannerSources = import.meta.glob<string>(
		[
			'../../../factorio-mod/facmandu-assistant/planner/**/*.{lua,cfg,md,json,txt}',
			'../../../factorio-mod/facmandu-assistant/planner/**/LICENSE'
		],
		{ query: '?raw', import: 'default', eager: true }
	);
	plannerImages = import.meta.glob<string>(
		'../../../factorio-mod/facmandu-assistant/planner/**/*.png',
		{ query: '?inline', import: 'default', eager: true }
	);
} catch (cause) {
	if (typeof import.meta.glob === 'function') throw cause;
	// Bun runs source directly; Vite embeds these files in the deployed app.
	const directory = fileURLToPath(
		new URL('../../../factorio-mod/facmandu-assistant/planner/', import.meta.url)
	);
	plannerSources = {};
	plannerImages = {};
	for (const path of readdirSync(directory, { recursive: true, encoding: 'utf8' })) {
		if (path.endsWith('.png')) plannerImages[`/planner/${path}`] = join(directory, path);
		else if (/\.(lua|cfg|md|json|txt)$|(?:^|\/)LICENSE$/.test(path))
			plannerSources[`/planner/${path}`] = readFileSync(join(directory, path), 'utf8');
	}
}
function imageBytes(source: string) {
	return new Uint8Array(
		source.startsWith('data:image/png;base64,')
			? Buffer.from(source.slice('data:image/png;base64,'.length), 'base64')
			: readFileSync(source)
	);
}

export const tobyModInfo = info;
export function tobyModArchive() {
	const encode = new TextEncoder();
	return zipSync(
		Object.fromEntries([
			...Object.entries({
				'info.json': JSON.stringify(info),
				'control.lua': control,
				'task-store.lua': taskStore,
				'task-board.lua': taskBoard,
				'data.lua': data,
				'data-final-fixes.lua': dataFinalFixes,
				'events.lua': events,
				'drone.lua': drone,
				'territory.lua': territory,
				'drone-visuals.lua': droneVisuals,
				'references.lua': references,
				'sandbox.lua': sandbox,
				'robot-trial.lua': robotTrial,
				'drone-prototypes.lua': dronePrototypes,
				'locale/en/toby.cfg': locale,
				'README.md': readme
			}).map(
				([name, source]) => [`${info.name}_${info.version}/${name}`, encode.encode(source)] as const
			),
			...Object.entries(plannerSources).map(([path, source]) => {
				const relative = path.slice(path.indexOf('/planner/') + 1);
				// Factorio loads locales only from the root locale directory.
				const target = relative.endsWith('.cfg')
					? relative.replace('planner/locale/', 'locale/')
					: relative;
				return [`${info.name}_${info.version}/${target}`, encode.encode(source)] as const;
			}),
			...Object.entries(plannerImages).map(([path, source]) => [
				`${info.name}_${info.version}/${path.slice(path.indexOf('/planner/') + 1)}`,
				imageBytes(source)
			]),
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
						imageBytes(source)
					] as const
			)
		]),
		// Published and served archives must have identical bytes.
		{ mtime: new Date(2026, 0, 1) }
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
