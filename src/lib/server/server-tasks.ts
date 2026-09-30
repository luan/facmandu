import { setTimeout as delay } from 'node:timers/promises';
import type { WorldGenerationSettings } from '../map-generation';
import { publishActivity } from './activity';
import type { ManagedServer } from './db/schema';
import { ServerError } from './server-files';
import { downloadMod } from './server-mods';
import { serverStatus, stopFactorio } from './server-process';
import { createSave } from './server-saves';
import { downloadVersion } from './server-versions';

// One process owns mutations; use database leases before running multiple app processes.
const processTasks = globalThis as typeof globalThis & {
	facmanduServerTasks?: Map<string, string>;
};
processTasks.facmanduServerTasks ??= new Map<string, string>();
const busy = processTasks.facmanduServerTasks;
export const serverTask = (serverId: string) => busy.get(serverId);
export function reserveServer(serverId: string, label: string): (() => void) | null {
	if (busy.has(serverId)) return null;
	busy.set(serverId, label);
	return () => busy.delete(serverId);
}
export function startServerDownload(
	server: ManagedServer,
	download:
		| { kind: 'mod'; name: string; version: string }
		| { kind: 'version'; branch: string; version: string },
	release: () => void
) {
	const task = download.kind === 'mod' ? 'mod-download' : 'version-download';
	const label =
		download.kind === 'mod'
			? `${download.name} ${download.version}`
			: `Factorio ${download.version}`;
	const report = (state: 'running' | 'done' | 'error', message: string, completed = 0) =>
		publishActivity({
			scope: 'server',
			targetId: server.id,
			task,
			state,
			message,
			completed,
			total: 100
		});
	report('running', `Downloading ${label}`);
	void (async () => {
		try {
			if (download.kind === 'version')
				await downloadVersion(server, download.branch, download.version, (message, percent) =>
					report('running', message, percent)
				);
			else await downloadMod(server, download.name, download.version);
			report('done', `${label} ${download.kind === 'version' ? 'installed' : 'downloaded'}`, 100);
		} catch (cause) {
			report('error', cause instanceof Error ? cause.message : `Could not download ${label}`);
		} finally {
			release();
		}
	})();
}
export function stopServer(server: ManagedServer) {
	const release = reserveServer(server.id, 'Stopping server');
	if (!release) throw new ServerError(409, serverTask(server.id) || 'Server busy');
	const report = (state: 'running' | 'done' | 'error', message: string) =>
		publishActivity({
			scope: 'server',
			targetId: server.id,
			task: 'stop',
			state,
			message,
			completed: state === 'done' ? 1 : 0,
			total: 1
		});
	report('running', 'Saving and stopping server');
	void (async () => {
		try {
			await stopFactorio(server);
			for (let attempt = 0; attempt < 120; attempt++) {
				if (!(await serverStatus(server)).running) {
					report('done', 'Server stopped');
					return;
				}
				await delay(1000);
			}
			report('error', 'Still saving. Check the console.');
		} catch (cause) {
			report('error', cause instanceof Error ? cause.message : 'Could not stop server');
		} finally {
			release();
		}
	})();
}

export function startSaveCreation(
	server: ManagedServer,
	name: string,
	release: () => void,
	settings: WorldGenerationSettings = {}
) {
	const report = (state: 'running' | 'done' | 'error', message: string) =>
		publishActivity({
			scope: 'server',
			targetId: server.id,
			task: 'save-create',
			state,
			message,
			completed: state === 'done' ? 1 : 0,
			total: 1
		});
	report('running', `Creating ${name}`);
	void (async () => {
		try {
			await createSave(server, name, settings);
			report('done', `Created ${name}`);
		} catch (cause) {
			report('error', cause instanceof Error ? cause.message : 'Could not create save');
		} finally {
			release();
		}
	})();
}
