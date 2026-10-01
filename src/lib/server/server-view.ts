import { eq } from 'drizzle-orm';
import { db } from './db';
import * as table from './db/schema';
import { liveModSettings } from './mod-settings-defs';
import { gameSettings, modSettings, serverConfig, serverUsers } from './server-files';
import { loadModSyncPlan, modSyncJob } from './server-mod-sync';
import { serverMods } from './server-mods';
import { serverStatus } from './server-process';
import { serverSaves } from './server-saves';
import { serverVersions } from './server-versions';

const secretKey = /password|token|secret|username/iu;
export const settingKind = (value: unknown) =>
	Array.isArray(value)
		? 'json'
		: value !== null && typeof value === 'object'
			? 'json'
			: typeof value;

export function settingFields(settings: Record<string, unknown>) {
	return Object.entries(editableSettings(settings))
		.filter(([key, value]) => !key.startsWith('_comment_') && value !== null)
		.map(([key, value]) => ({
			key,
			kind: settingKind(value),
			value: typeof value === 'object' ? JSON.stringify(value) : String(value),
			description:
				typeof settings[`_comment_${key}`] === 'string' ? String(settings[`_comment_${key}`]) : ''
		}));
}

function containsCredential(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsCredential);
	if (value && typeof value === 'object') {
		return Object.entries(value).some(
			([key, field]) => secretKey.test(key) || containsCredential(field)
		);
	}
	return false;
}

export function editableSettings(settings: Record<string, unknown>) {
	// Hide credential-bearing containers so edits cannot erase secrets.
	return Object.fromEntries(
		Object.entries(settings).filter(
			([key, value]) => !secretKey.test(key) && !containsCredential(value)
		)
	);
}

export async function loadServerView(
	server: table.ManagedServer,
	userId: string,
	activeTab: string,
	selectedListId: string | null
) {
	const status = await serverStatus(server);
	const [saves, selection, mods, versions, settings, modSettingValues, admins, bans, whitelist] =
		await Promise.allSettled([
			activeTab === 'saves' ? serverSaves(server) : Promise.resolve([]),
			serverConfig(server),
			serverMods(server),
			['settings', 'mods'].includes(activeTab)
				? serverVersions(server)
				: Promise.resolve({ available: {}, installed: {} as Record<string, string[]> }),
			activeTab === 'settings' ? gameSettings(server) : Promise.resolve({}),
			activeTab === 'settings'
				? status.running
					? liveModSettings(server)
					: modSettings(server)
				: Promise.resolve({}),
			activeTab === 'access' ? serverUsers(server, 'factorio-admins') : Promise.resolve([]),
			activeTab === 'access' ? serverUsers(server, 'factorio-bans') : Promise.resolve([]),
			activeTab === 'access' ? serverUsers(server, 'factorio-whitelist') : Promise.resolve([])
		]);
	const user =
		activeTab === 'settings'
			? await db
					.select({ username: table.user.factorioUsername, token: table.user.factorioToken })
					.from(table.user)
					.where(eq(table.user.id, userId))
					.get()
			: null;
	const [plan] = await Promise.allSettled([
		activeTab === 'mods' && selectedListId && mods.status === 'fulfilled'
			? loadModSyncPlan(server, userId, selectedListId, mods.value.mods)
			: Promise.resolve(null)
	]);
	return {
		selectedPlan: plan?.status === 'fulfilled' ? plan.value : null,
		modSyncJob: await modSyncJob(server.id),
		status,
		saves: saves.status === 'fulfilled' ? saves.value : [],
		selectedSave: selection.status === 'fulfilled' ? selection.value.save : '',
		resumeAutosave: selection.status === 'fulfilled' ? selection.value.resumeAutosave : true,
		useWhitelist: selection.status === 'fulfilled' ? selection.value.useWhitelist : undefined,
		mods: mods.status === 'fulfilled' ? mods.value.mods : [],
		versions: versions.status === 'fulfilled' ? versions.value : null,
		settings:
			settings.status === 'fulfilled'
				? JSON.stringify(editableSettings(settings.value), null, 2)
				: null,
		settingFields: settings.status === 'fulfilled' ? settingFields(settings.value) : [],
		modSettings:
			modSettingValues.status === 'fulfilled'
				? JSON.stringify(modSettingValues.value, null, 2)
				: null,
		factorioUser:
			selection.status === 'fulfilled'
				? { username: selection.value.account.username, hasToken: !!selection.value.account.token }
				: null,
		admins: admins.status === 'fulfilled' ? admins.value : [],
		bans: bans.status === 'fulfilled' ? bans.value : [],
		whitelist: whitelist.status === 'fulfilled' ? whitelist.value : [],
		unavailable: Object.entries({
			'mod list review': plan,
			saves,
			'selected save': selection,
			mods,
			versions,
			'server settings': settings,
			'mod settings': modSettingValues,
			admins,
			bans,
			whitelist
		})
			.filter(([, result]) => result?.status === 'rejected')
			.map(([name]) => name),
		canSyncFactorioAccount: !!user?.username && !!user.token
	};
}
export type ServerView = Awaited<ReturnType<typeof loadServerView>>;
