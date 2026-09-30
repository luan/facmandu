import { execFile } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { ManagedServer } from './db/schema';
import { ServerError, saveGameSettings, serverConfig } from './server-files';

export const run = promisify(execFile);
export const unitName = (server: ManagedServer) => {
	if (!/^[a-zA-Z0-9-]+$/u.test(server.id)) throw new ServerError(400, 'Invalid server identifier');
	return `facmandu-factorio-${server.id}.service`;
};
export async function executable(server: ManagedServer) {
	const config = await serverConfig(server);
	if (!config.version) throw new ServerError(409, 'Select a Factorio version first');
	return join(
		server.directory,
		'versions',
		config.version.branch,
		config.version.version,
		'bin',
		'x64',
		'factorio'
	);
}
export async function processState(server: ManagedServer) {
	const { stdout } = await run(
		'systemctl',
		['--user', 'show', unitName(server), '--property=ActiveState,SubState'],
		{ timeout: 5000 }
	);
	const values = Object.fromEntries(
		stdout
			.trim()
			.split('\n')
			.map((line) => line.split('='))
	);
	return {
		running: ['active', 'activating', 'deactivating'].includes(values.ActiveState ?? ''),
		stopping: values.ActiveState === 'deactivating',
		failed: values.ActiveState === 'failed'
	};
}
export async function serverStatus(server: ManagedServer) {
	const [state, config] = await Promise.all([processState(server), serverConfig(server)]);
	return {
		...state,
		can_download: true,
		is_configured: !!config.version,
		version: {
			full: config.version?.version ?? '',
			branch: config.version?.branch ?? '',
			version: config.version?.version ?? ''
		}
	};
}
export async function requireStopped(server: ManagedServer) {
	if ((await processState(server)).running) throw new ServerError(409, 'Stop the server first');
}
// systemd owns Factorio independently of web-server reloads and persists its exit status.
export async function startFactorio(server: ManagedServer) {
	await requireStopped(server);
	if (!isAbsolute(server.directory) || /[\r\n]/u.test(server.directory))
		throw new ServerError(400, 'Invalid server directory');
	const config = await serverConfig(server);
	const binary = await executable(server);
	await stat(binary);
	const installed = await run(binary, ['--version'], { timeout: 10000 });
	if (!installed.stdout.includes(`Version: ${config.version?.version} `))
		throw new ServerError(409, 'The selected installation changed. Download this version again.');
	const saves = await readdir(join(server.directory, 'saves'));
	let save = config.save;
	if (!save) {
		const candidates = await Promise.all(
			saves
				.filter((name) => name.endsWith('.zip'))
				.map(async (name) => ({
					name,
					modified: (await stat(join(server.directory, 'saves', name))).mtimeMs
				}))
		);
		save = candidates.sort((a, b) => b.modified - a.modified)[0]?.name ?? '';
	}
	if (!save) throw new ServerError(409, 'Create or upload a save first');
	await stat(join(server.directory, 'saves', save));
	if (config.account.username && config.account.token)
		await saveGameSettings(server, config.account);
	const args = await factorioArguments(server);
	args.push(
		'--start-server',
		join(server.directory, 'saves', save),
		'--bind',
		`${config.bindAddress.includes(':') ? `[${config.bindAddress}]` : config.bindAddress}:${server.gamePort}`,
		'--rcon-bind',
		`127.0.0.1:${server.rconPort}`,
		'--rcon-password',
		config.rconPassword
	);
	if (config.useWhitelist)
		args.push(
			'--use-server-whitelist',
			'--server-whitelist',
			join(server.directory, 'config', 'server-whitelist.json')
		);
	const quote = (value: string) =>
		'"' +
		value
			.replaceAll('\\', '\\\\')
			.replaceAll('"', '\\"')
			.replaceAll('%', '%%')
			.replaceAll('$', '$$') +
		'"';
	const units = join(homedir(), '.config', 'systemd', 'user');
	await mkdir(units, { recursive: true });
	await writeFile(
		join(units, unitName(server)),
		`[Unit]\nDescription=Facmandu Factorio ${server.id}\n[Service]\nType=exec\nWorkingDirectory=${server.directory.replaceAll('%', '%%')}\nExecStart=${[binary, ...args].map(quote).join(' ')}\nKillSignal=SIGINT\nTimeoutStopSec=infinity\nRestart=no\nStandardOutput=append:${server.directory.replaceAll('%', '%%')}/logs/server.log\nStandardError=inherit\nUMask=0077\n`,
		{ mode: 0o600 }
	);
	await run('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 });
	await run('systemctl', ['--user', 'start', unitName(server)], { timeout: 15000 });
}
export async function stopFactorio(server: ManagedServer) {
	await run('systemctl', ['--user', 'stop', '--no-block', unitName(server)], { timeout: 5000 });
}
export async function factorioArguments(server: ManagedServer) {
	const binary = await executable(server);
	const data = join(binary, '..', '..', '..', 'data');
	const config = join(server.directory, '.factorio', 'facmandu.ini');
	await writeFile(
		config,
		`[path]\nread-data=${data}\nwrite-data=${join(server.directory, '.factorio')}\n`,
		{ mode: 0o600 }
	);
	return [
		'--config',
		config,
		'--mod-directory',
		join(server.directory, 'mods'),
		'--server-settings',
		join(server.directory, 'config', 'server-settings.json'),
		'--server-adminlist',
		join(server.directory, 'config', 'server-adminlist.json'),
		'--server-banlist',
		join(server.directory, 'config', 'server-banlist.json')
	];
}
