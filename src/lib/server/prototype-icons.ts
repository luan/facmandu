import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ManagedServer } from './db/schema';
import { ServerError, safeFileName, serverConfig } from './server-files';
import { executable } from './server-process';

const run = promisify(execFile);
const exportsInProgress = new Map<string, Promise<string>>();
const failedExports = new Map<string, number>();

export const prototypeIconKinds = ['technology', 'item', 'fluid', 'recipe', 'entity'] as const;
export type PrototypeIconKind = (typeof prototypeIconKinds)[number];

export function validPrototypeIcon(kind: string, name: string): kind is PrototypeIconKind {
	return (
		prototypeIconKinds.some((candidate) => candidate === kind) &&
		name.length > 0 &&
		name.length <= 200 &&
		safeFileName(name)
	);
}

async function packageFiles(
	directory: string,
	prefix = '',
	seen = new Set<string>(),
	depth = 0
): Promise<(string | number)[][]> {
	if (depth > 20) throw new ServerError(409, 'Mod directory nesting is too deep');
	const source = await realpath(directory);
	if (seen.has(source)) return [];
	seen.add(source);
	const entries = (await readdir(directory, { withFileTypes: true }))
		.filter((entry) => entry.isFile() || entry.isDirectory() || entry.isSymbolicLink())
		.sort((left, right) => left.name.localeCompare(right.name));
	const files: (string | number)[][] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		const relative = join(prefix, entry.name);
		const info = await stat(path);
		files.push([relative, info.size, info.mtimeMs]);
		if (info.isDirectory()) files.push(...(await packageFiles(path, relative, seen, depth + 1)));
	}
	return files;
}

export async function prototypeFingerprint(server: ManagedServer): Promise<string> {
	const config = await serverConfig(server);
	if (!config.version) throw new ServerError(409, 'Select a Factorio version first');
	const mods = join(server.directory, 'mods');
	const files = await packageFiles(mods);
	const binary = await stat(await executable(server));
	const modList = await readFile(join(mods, 'mod-list.json'));
	const modSettings = await readFile(join(mods, 'mod-settings.dat')).catch(
		(cause: NodeJS.ErrnoException) => {
			if (cause.code === 'ENOENT') return Buffer.alloc(0);
			throw cause;
		}
	);
	files.sort(([left], [right]) => String(left).localeCompare(String(right)));
	return createHash('sha256')
		.update(JSON.stringify([config.version, binary.size, binary.mtimeMs, files]))
		.update(modList)
		.update(modSettings)
		.digest('hex');
}

async function exportIcons(server: ManagedServer, fingerprint: string): Promise<string> {
	const cache = join(server.directory, 'icon-cache');
	const ready = join(cache, fingerprint);
	try {
		await stat(join(ready, '.complete'));
		return ready;
	} catch {
		// A complete native export is written atomically below.
	}
	const staging = join(cache, `.building-${randomUUID()}`);
	const writeData = join(staging, 'write');
	await mkdir(writeData, { recursive: true });
	try {
		await run(
			'python3',
			[
				join(homedir(), '.local/share/facmandu-renderer/current/render.py'),
				'--icons',
				'--binary',
				await executable(server),
				'--mods',
				join(server.directory, 'mods'),
				'--profile',
				join(server.directory, 'sprite-cache', fingerprint),
				'--output',
				join(writeData, 'script-output')
			],
			{ timeout: 600_000, maxBuffer: 4 * 1024 * 1024 }
		);
		if ((await prototypeFingerprint(server)) !== fingerprint)
			throw new ServerError(409, 'Server mods changed during icon export');
		await stat(join(writeData, 'script-output'));
		await writeFile(join(staging, '.complete'), fingerprint, { mode: 0o600 });
		await rename(staging, ready);
		return ready;
	} catch (cause) {
		if (cause instanceof ServerError) throw cause;
		throw new ServerError(503, 'Factorio icon export failed');
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

export async function prototypeIcon(server: ManagedServer, kind: PrototypeIconKind, name: string) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const fingerprint = await prototypeFingerprint(server);
		const key = `${server.id}:${fingerprint}`;
		if ((failedExports.get(key) ?? 0) > Date.now())
			throw new ServerError(503, 'Factorio icon export temporarily unavailable');
		let exportPromise = exportsInProgress.get(key);
		if (!exportPromise) {
			exportPromise = exportIcons(server, fingerprint).catch((cause: unknown) => {
				if (!(cause instanceof ServerError && cause.status === 409))
					failedExports.set(key, Date.now() + 30_000);
				throw cause;
			});
			exportsInProgress.set(key, exportPromise);
			void exportPromise.finally(() => exportsInProgress.delete(key)).catch(() => {});
		}
		let root: string;
		try {
			root = await exportPromise;
		} catch (cause) {
			if (cause instanceof ServerError && cause.status === 409) continue;
			throw cause;
		}
		if ((await prototypeFingerprint(server)) !== fingerprint) continue;
		try {
			return await readFile(join(root, 'write', 'script-output', kind, `${name}.png`));
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw cause;
		}
	}
	throw new ServerError(503, 'Server mods kept changing during icon export');
}
