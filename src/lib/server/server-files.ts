import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import {
	createModSettings,
	decodeModSettings,
	encodeModSettings,
	getModSettingValues,
	settingSections,
	updateModSettingValues
} from '$lib/mod-settings';
import type { ManagedServer } from './db/schema';

export const versionPattern = /^\d+\.\d+\.\d+$/u;
export const safeFileName = (name: string) =>
	!!name &&
	name !== '.' &&
	name !== '..' &&
	!/[\\/]/u.test(name) &&
	[...name].every((char) => char.charCodeAt(0) >= 32);
export class ServerError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}
export const gameAssistantSchema = z.object({
	enabled: z.boolean().default(false),
	ownerId: z.string().default(''),
	model: z.string().default(''),
	effort: z.string().default(''),
	actions: z.enum(['off', 'admins', 'allowlist']).default('off'),
	players: z
		.array(z.string().regex(/^[A-Za-z0-9_-]{3,30}$/u))
		.max(100)
		.default([])
});
export type GameAssistantConfig = z.infer<typeof gameAssistantSchema>;
export const configSchema = z.object({
	gameAssistant: gameAssistantSchema.prefault({}),
	bindAddress: z
		.string()
		.refine((value) => isIP(value) !== 0, 'Invalid game bind address')
		.default('0.0.0.0'),
	version: z
		.object({
			branch: z.enum(['stable', 'experimental']),
			version: z.string().regex(versionPattern)
		})
		.nullable()
		.default(null),
	save: z
		.string()
		.refine((value) => !value || safeFileName(value))
		.default(''),
	// An explicit save selection bypasses autosaves for its first launch.
	resumeAutosave: z.boolean().default(true),
	autosaveAfter: z.number().nonnegative().default(0),
	useWhitelist: z.boolean().default(false),
	rconPassword: z.string().min(16),
	account: z
		.object({ username: z.string(), token: z.string() })
		.default({ username: '', token: '' })
});
export type ServerConfig = z.infer<typeof configSchema>;
export async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, 'utf8'));
}
export async function writeJson(path: string, value: unknown) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
export const serverConfig = async (server: ManagedServer) =>
	configSchema.parse(await readJson(join(server.directory, 'facmandu.json')));
export async function updateServerConfig(server: ManagedServer, changes: Partial<ServerConfig>) {
	await writeJson(
		join(server.directory, 'facmandu.json'),
		configSchema.parse({ ...(await serverConfig(server)), ...changes })
	);
}
export async function initializeServer(server: ManagedServer) {
	for (const name of ['config', 'mods', 'saves', 'logs', 'versions', 'downloads', '.factorio'])
		await mkdir(join(server.directory, name), { recursive: true });
	const writeInitial = async (path: string, value: unknown) => {
		try {
			await writeFile(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
		} catch (cause) {
			if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause;
		}
	};
	// Setup retries create missing files without replacing a downloaded mod, save, or credential.
	await writeInitial(
		join(server.directory, 'facmandu.json'),
		configSchema.parse({ rconPassword: randomUUID() })
	);
	await writeInitial(join(server.directory, 'mods', 'mod-list.json'), {
		mods: [{ name: 'base', enabled: true }]
	});
	await writeInitial(join(server.directory, 'config', 'server-settings.json'), {
		name: server.name,
		description: '',
		tags: [],
		max_players: 10,
		visibility: { public: false, lan: true },
		require_user_verification: true,
		autosave_interval: 5,
		autosave_slots: 3
	});
	for (const name of ['server-adminlist', 'server-banlist', 'server-whitelist'])
		await writeInitial(join(server.directory, 'config', `${name}.json`), []);
}
export async function gameSettings(server: ManagedServer) {
	return z
		.record(z.string(), z.unknown())
		.parse(await readJson(join(server.directory, 'config', 'server-settings.json')));
}
export async function saveGameSettings(server: ManagedServer, changes: Record<string, unknown>) {
	await writeJson(join(server.directory, 'config', 'server-settings.json'), {
		...(await gameSettings(server)),
		...changes
	});
}

const modSettingName = z
	.string()
	.min(1)
	.max(200)
	.refine(
		(value) =>
			value === value.trim() &&
			[...value].every(
				(character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
			),
		'Invalid setting name'
	);
const modSettingValue = z.union([
	z.string().max(2000),
	z.number().finite(),
	z.boolean(),
	z
		.object({
			r: z.number().finite(),
			g: z.number().finite(),
			b: z.number().finite(),
			a: z.number().finite().optional()
		})
		.strict()
]);
const modSettingSection = z.record(modSettingName, z.object({ value: modSettingValue }).strict());
export const modSettingsSchema = z
	.object({
		startup: modSettingSection.default({}),
		'runtime-global': modSettingSection.default({}),
		'runtime-per-user': modSettingSection.default({})
	})
	.strict();
export type ModSettings = z.infer<typeof modSettingsSchema>;

async function modSettingsDocument(server: ManagedServer) {
	try {
		const bytes = await readFile(join(server.directory, 'mods', 'mod-settings.dat'));
		try {
			return decodeModSettings(bytes);
		} catch {
			throw new ServerError(
				422,
				'Could not read mod-settings.dat; the existing file was preserved'
			);
		}
	} catch (cause) {
		if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
		const config = await serverConfig(server);
		if (!config.version)
			throw new ServerError(409, 'Select a Factorio version before editing mod settings');
		return createModSettings(config.version.version);
	}
}
export async function modSettings(server: ManagedServer): Promise<ModSettings> {
	const values = getModSettingValues(await modSettingsDocument(server));
	return modSettingsSchema.parse(
		Object.fromEntries(
			settingSections.map((section) => [
				section,
				Object.fromEntries(
					Object.entries(values[section]).map(([name, value]) => [name, { value }])
				)
			])
		)
	);
}
export async function saveModSettings(server: ManagedServer, data: ModSettings) {
	const document = await modSettingsDocument(server);
	const changes = Object.fromEntries(
		settingSections.map((section) => [
			section,
			Object.fromEntries(
				Object.entries(data[section]).map(([name, setting]) => [name, setting.value])
			)
		])
	);
	const path = join(server.directory, 'mods', 'mod-settings.dat');
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, encodeModSettings(updateModSettingValues(document, changes)), {
			mode: 0o600
		});
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
export const userListNames = {
	'factorio-admins': 'server-adminlist',
	'factorio-bans': 'server-banlist',
	'factorio-whitelist': 'server-whitelist'
} as const;
export type UserList = keyof typeof userListNames;
const banSchema = z.array(
	z.union([z.string(), z.object({ username: z.string(), reason: z.string().default('') })])
);
export async function serverUsers(server: ManagedServer, list: UserList) {
	const users = await readJson(join(server.directory, 'config', `${userListNames[list]}.json`));
	return list === 'factorio-bans'
		? banSchema.parse(users).map((entry) => (typeof entry === 'string' ? entry : entry.username))
		: z.array(z.string()).parse(users);
}
export async function changeServerUser(
	server: ManagedServer,
	list: UserList,
	username: string,
	add: boolean
) {
	if (!/^[A-Za-z0-9_-]{3,30}$/u.test(username)) throw new ServerError(400, 'Invalid username');
	const { processState } = await import('./server-process');
	if ((await processState(server)).running) {
		const { rcon } = await import('./server-rcon');
		const command =
			list === 'factorio-admins'
				? add
					? '/promote'
					: '/demote'
				: list === 'factorio-bans'
					? add
						? '/ban'
						: '/unban'
					: add
						? '/whitelist add'
						: '/whitelist remove';
		await rcon(server, `${command} ${username}`);
	}
	const path = join(server.directory, 'config', `${userListNames[list]}.json`);
	if (list === 'factorio-bans') {
		const users = banSchema.parse(await readJson(path));
		const remaining = users.filter(
			(entry) => (typeof entry === 'string' ? entry : entry.username) !== username
		);
		await writeJson(path, add ? [...remaining, { username, reason: '' }] : remaining);
	} else {
		const users = await serverUsers(server, list);
		await writeJson(
			path,
			add ? [...new Set([...users, username])] : users.filter((name) => name !== username)
		);
	}
}
