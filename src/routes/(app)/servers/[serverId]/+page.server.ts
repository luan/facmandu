import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { RCON_COMMAND_BYTES } from '$lib/console';
import { worldGenerationSchema } from '$lib/map-generation';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { validModName } from '$lib/server/mod-names';
import { saveLiveModSettings } from '$lib/server/mod-settings-defs';
import {
	changeServerUser,
	gameSettings,
	modSettingsSchema,
	ServerError,
	saveGameSettings,
	saveModSettings,
	type UserList,
	updateServerConfig
} from '$lib/server/server-files';
import { modSyncJob } from '$lib/server/server-mod-sync';
import { installMod, removeMod, toggleMod } from '$lib/server/server-mods';
import { requireStopped, serverStatus, startFactorio } from '$lib/server/server-process';
import { rcon } from '$lib/server/server-rcon';
import { deleteSave, savePath, serverSaves, uploadSave } from '$lib/server/server-saves';
import {
	reserveServer,
	serverTask,
	startSaveCreation,
	startServerDownload,
	stopServer
} from '$lib/server/server-tasks';
import { selectVersion, uninstallVersion } from '$lib/server/server-versions';
import { editableSettings, settingFields, settingKind } from '$lib/server/server-view';
import { canManageServer, publicServer, requireServer } from '$lib/server/servers';
import type { Actions, PageServerLoad } from './$types';

const jsonObject = z.record(z.string(), z.unknown());
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const usernamePattern = /^[A-Za-z0-9_-]{3,30}$/u;
function stringField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : '';
}

function assertOperator(userId: string | undefined): void {
	if (!canManageServer(userId)) error(403, 'Server management is restricted');
}

export const load: PageServerLoad = async (event) => {
	const server = await requireServer(event.locals.user?.id, event.params.serverId ?? '');
	const requestedTab = event.url.searchParams.get('tab');
	const activeTab =
		requestedTab && ['mods', 'saves', 'settings', 'access', 'console'].includes(requestedTab)
			? requestedTab
			: 'console';
	return {
		server: publicServer(server),
		activeTab,
		selectedListId: event.url.searchParams.get('list') ?? server.selectedModlist
	};
};

export const actions: Actions = {
	manage: async (event) => {
		let server = await requireServer(event.locals.user?.id, event.params.serverId ?? '');
		assertOperator(event.locals.user?.id);
		const form = await event.request.formData();
		const operation = stringField(form, 'operation');
		const name = stringField(form, 'name');
		const version = stringField(form, 'version');
		const branch = stringField(form, 'branch');
		const username = stringField(form, 'username');

		const release = ['rcon', 'stop'].includes(operation)
			? () => {}
			: reserveServer(server.id, 'Updating server');
		if (!release)
			return fail(409, { message: `${serverTask(server.id)}. Wait for this task to finish.` });
		let background = false;
		try {
			server = await requireServer(event.locals.user?.id, server.id);
			if (
				['start', 'toggleMod', 'installMod', 'uninstallMod', 'deleteMod', 'selectVersion'].includes(
					operation
				) &&
				(await modSyncJob(server.id))?.status === 'running'
			)
				return fail(409, { message: 'Wait for this server’s mod update to finish' });
			switch (operation) {
				case 'stop':
					stopServer(server);
					return { message: 'Shutdown requested. The server will finish saving before it stops.' };
				case 'start':
					await startFactorio(server);
					break;
				case 'rcon': {
					const command = stringField(form, 'command');
					if (!command || Buffer.byteLength(command, 'utf8') > RCON_COMMAND_BYTES)
						return fail(400, {
							message: `RCON commands must be 1–${RCON_COMMAND_BYTES} UTF-8 bytes`
						});
					const result = { output: await rcon(server, command) };
					return {
						message: 'Command sent',
						output:
							result.output.length > 256 * 1024
								? `${result.output.slice(0, 256 * 1024)}\n[Output truncated]`
								: result.output
					};
				}
				case 'setWhitelist': {
					const enabled = stringField(form, 'enabled');
					if (!['true', 'false'].includes(enabled))
						return fail(400, { message: 'Invalid whitelist setting' });
					await updateServerConfig(server, { useWhitelist: enabled === 'true' });
					break;
				}
				case 'selectSave': {
					const saves = await serverSaves(server);
					if (name && !saves.some((save) => save.name === name)) {
						return fail(400, { message: 'Save not found' });
					}
					await updateServerConfig(server, { save: name });
					break;
				}
				case 'deleteSave':
					await deleteSave(server, name);
					break;
				case 'createSave': {
					savePath(server, name);
					const rawSettings = stringField(form, 'worldGeneration');
					if (rawSettings.length > 64 * 1024)
						return fail(400, { message: 'Map settings are too large' });
					let input: unknown = {};
					try {
						if (rawSettings) input = JSON.parse(rawSettings);
					} catch {
						return fail(400, { message: 'Invalid map settings' });
					}
					const settings = worldGenerationSchema.safeParse(input);
					if (!settings.success)
						return fail(400, { message: settings.error.issues[0]?.message ?? 'Invalid map settings' });
					startSaveCreation(server, name, release, settings.data);
					background = true;
					return { success: true };
				}
				case 'uploadSave': {
					const file = form.get('save');
					if (!(file instanceof File)) return fail(400, { message: 'Choose a save file' });
					await uploadSave(server, file);
					break;
				}
				case 'toggleMod': {
					const enabled = stringField(form, 'enabled');
					if (
						!validModName(name) ||
						!['true', 'false'].includes(enabled) ||
						(name === 'base' && enabled !== 'true')
					) {
						return fail(400, { message: 'Invalid mod' });
					}
					await toggleMod(server, name, enabled === 'true');
					break;
				}
				case 'downloadMod':
				case 'installMod':
				case 'uninstallMod':
				case 'deleteMod': {
					if (!validModName(name) || !versionPattern.test(version)) {
						return fail(400, { message: 'Invalid mod or version' });
					}
					if (operation === 'downloadMod') {
						background = true;
						startServerDownload(server, { kind: 'mod', name, version }, release);
						return { message: 'Mod download started. Follow its progress in Activity.' };
					}
					if (operation === 'installMod') await installMod(server, name, version);
					else await removeMod(server, name, version, operation === 'deleteMod');
					break;
				}
				case 'saveSettings': {
					const raw = stringField(form, 'settings');
					if (raw.length > 256_000) return fail(400, { message: 'Settings are too large' });
					let submitted: unknown;
					try {
						submitted = JSON.parse(raw);
					} catch {
						return fail(400, { message: 'Settings must be valid JSON' });
					}
					const parsed = jsonObject.safeParse(submitted);
					if (
						!parsed.success ||
						JSON.stringify(editableSettings(parsed.data)) !== JSON.stringify(parsed.data)
					) {
						return fail(400, { message: 'Settings must be a JSON object without credentials' });
					}
					const current = await gameSettings(server);
					const editable = editableSettings(current);
					if (
						Object.keys(parsed.data).some(
							(key) => Object.hasOwn(current, key) && !Object.hasOwn(editable, key)
						)
					) {
						return fail(400, { message: 'Credential settings must be preserved' });
					}
					await saveGameSettings(server, parsed.data);
					break;
				}
				case 'saveSettingsForm': {
					const current = await gameSettings(server);
					const changes: Record<string, unknown> = {};
					for (const field of settingFields(current)) {
						const raw = form.get(`setting:${field.key}`);
						if (typeof raw !== 'string' || raw.length > 256_000) {
							return fail(400, { message: `Invalid ${field.key} setting` });
						}
						let value: unknown = raw;
						if (field.kind === 'number' || field.kind === 'json') {
							try {
								value = JSON.parse(raw);
							} catch {
								return fail(400, { message: `Invalid JSON for ${field.key}` });
							}
						} else if (field.kind === 'boolean') {
							value = raw === 'true' ? true : raw === 'false' ? false : null;
						}
						if (
							settingKind(value) !== field.kind ||
							(field.kind === 'number' && !Number.isFinite(value)) ||
							(field.kind === 'json' && Array.isArray(value) !== Array.isArray(current[field.key]))
						) {
							return fail(400, { message: `Invalid ${field.key} setting` });
						}
						changes[field.key] = value;
					}
					if (JSON.stringify(editableSettings(changes)) !== JSON.stringify(changes)) {
						return fail(400, { message: 'Settings cannot contain credentials' });
					}
					await saveGameSettings(server, changes);
					break;
				}
				case 'saveModSettings': {
					const raw = stringField(form, 'modSettings');
					if (!raw || raw.length > 256_000)
						return fail(400, { message: 'Mod settings are missing or too large' });
					let submitted: unknown;
					try {
						submitted = JSON.parse(raw);
					} catch {
						return fail(400, { message: 'Mod settings must be valid JSON' });
					}
					const parsed = modSettingsSchema.safeParse(submitted);
					if (!parsed.success)
						return fail(400, {
							message: 'Mod settings must contain valid settings grouped by scope'
						});
					if ((await serverStatus(server)).running) {
						await saveLiveModSettings(server, parsed.data);
						await rcon(server, '/server-save');
					} else {
						await requireStopped(server);
						await saveModSettings(server, parsed.data);
					}
					break;
				}
				case 'downloadVersion':
				case 'selectVersion':
				case 'uninstallVersion': {
					if (!['stable', 'experimental'].includes(branch) || !versionPattern.test(version)) {
						return fail(400, { message: 'Invalid server version' });
					}
					if (operation !== 'downloadVersion') {
						const status = await serverStatus(server);
						if (status.running)
							return fail(409, { message: 'Stop the server before changing versions' });
						if (
							operation === 'uninstallVersion' &&
							status.version.branch === branch &&
							status.version.version === version
						) {
							return fail(409, { message: 'Select another version first' });
						}
					}
					if (operation === 'downloadVersion') {
						background = true;
						startServerDownload(server, { kind: 'version', branch, version }, release);
						return { message: 'Factorio download started. Follow its progress in Activity.' };
					}
					if (operation === 'selectVersion') await selectVersion(server, branch, version);
					else await uninstallVersion(server, branch, version);
					break;
				}
				case 'addUser':
				case 'removeUser': {
					const list = stringField(form, 'list');
					if (
						!['factorio-admins', 'factorio-bans', 'factorio-whitelist'].includes(list) ||
						!usernamePattern.test(username)
					) {
						return fail(400, { message: 'Invalid user or list' });
					}
					await changeServerUser(server, list as UserList, username, operation === 'addUser');
					break;
				}
				case 'syncFactorioAccount': {
					const user = await db
						.select({ username: table.user.factorioUsername, token: table.user.factorioToken })
						.from(table.user)
						.where(eq(table.user.id, event.locals.session?.userId ?? ''))
						.get();
					if (!user?.username || !user.token) {
						return fail(400, { message: 'Add Factorio credentials in Settings first' });
					}
					await updateServerConfig(server, {
						account: { username: user.username, token: user.token }
					});
					break;
				}
				case 'setFactorioAccount': {
					const token = stringField(form, 'token');
					if (!usernamePattern.test(username) || !token || token.length > 1000) {
						return fail(400, { message: 'Enter a valid Factorio username and token' });
					}
					await updateServerConfig(server, { account: { username, token } });
					break;
				}
				default:
					return fail(400, { message: 'Unknown server action' });
			}
			return { message: 'Server updated' };
		} catch (cause) {
			console.error(`Server action ${operation} failed`);
			return fail(cause instanceof ServerError ? cause.status : 502, {
				message:
					cause instanceof ServerError
						? cause.message
						: 'Server action failed. Check the server log.'
			});
		} finally {
			if (!background) release();
		}
	}
};
