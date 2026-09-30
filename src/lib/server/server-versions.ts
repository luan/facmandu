import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import { cachedPortalRequest } from './portal-cache';
import { ServerError, serverConfig, updateServerConfig, versionPattern } from './server-files';
import { requireStopped, run } from './server-process';

export type AvailableVersions = Record<string, { headless?: string }>;
export function factorioReleases() {
	return cachedPortalRequest(
		'factorio:latest-releases',
		'https://factorio.com/api/latest-releases',
		z.record(z.string(), z.object({ headless: z.string().optional() }).passthrough()),
		{ maxAgeMs: 24 * 60 * 60_000 }
	);
}
export async function serverVersions(server: ManagedServer) {
	const installed: Record<string, string[]> = {};
	for (const branch of ['stable', 'experimental']) {
		const directory = join(server.directory, 'versions', branch);
		const entries = await readdir(directory).catch(() => [] as string[]);
		installed[branch] = (
			await Promise.all(
				entries
					.filter((name) => versionPattern.test(name))
					.map(async (version) =>
						(
							await stat(join(directory, version, 'bin', 'x64', 'factorio')).catch(() => null)
						)?.isFile()
							? version
							: null
					)
			)
		).filter((item) => item !== null);
	}
	return { available: {} as AvailableVersions, installed };
}
export async function downloadVersion(
	server: ManagedServer,
	branch: string,
	version: string,
	progress: (message: string, percent: number) => void
) {
	if (!['stable', 'experimental'].includes(branch) || !versionPattern.test(version))
		throw new ServerError(400, 'Invalid version');
	const target = join(server.directory, 'versions', branch, version);
	if ((await serverVersions(server)).installed[branch]?.includes(version)) return;
	const staging = join(server.directory, 'versions', `.download-${randomUUID()}`);
	await mkdir(staging, { recursive: true });
	try {
		const response = await fetch(`https://factorio.com/get-download/${version}/headless/linux64`, {
			signal: AbortSignal.timeout(600_000)
		});
		if (!response.ok || !response.body)
			throw new ServerError(502, `Factorio download returned HTTP ${response.status}`);
		const total = Number(response.headers.get('content-length'));
		let received = 0,
			last = -1;
		const archive = join(staging, 'factorio.tar.xz');
		await pipeline(
			response.body,
			async function* (source) {
				for await (const chunk of source) {
					received += chunk.length;
					const percent = total > 0 ? Math.min(90, Math.floor((received / total) * 90)) : 0;
					if (percent !== last) {
						progress(`Downloading Factorio ${version}`, percent);
						last = percent;
					}
					yield chunk;
				}
			},
			createWriteStream(archive, { mode: 0o600 })
		);
		progress(`Extracting Factorio ${version}`, 90);
		const { stdout: entries } = await run('tar', ['-tf', archive], {
			maxBuffer: 8 * 1024 * 1024,
			timeout: 30000
		});
		if (
			entries.split('\n').some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))
		)
			throw new ServerError(502, 'Invalid Factorio archive paths');
		await run('tar', ['-xf', archive, '-C', staging, '--no-same-owner'], { timeout: 180000 });
		const { stdout } = await run(
			join(staging, 'factorio', 'bin', 'x64', 'factorio'),
			['--version'],
			{ timeout: 10000 }
		);
		if (!stdout.includes(`Version: ${version} `))
			throw new ServerError(502, 'Downloaded version does not match');
		await mkdir(join(server.directory, 'versions', branch), { recursive: true });
		await rename(join(staging, 'factorio'), target);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}
export async function selectVersion(server: ManagedServer, branch: string, version: string) {
	await requireStopped(server);
	if (!(await serverVersions(server)).installed[branch]?.includes(version))
		throw new ServerError(404, 'Version is not installed');
	await updateServerConfig(server, {
		version: { branch: branch === 'experimental' ? 'experimental' : 'stable', version }
	});
}
export async function uninstallVersion(server: ManagedServer, branch: string, version: string) {
	await requireStopped(server);
	const config = await serverConfig(server);
	if (config.version?.branch === branch && config.version.version === version)
		throw new ServerError(409, 'Select another version first');
	if (!(await serverVersions(server)).installed[branch]?.includes(version))
		throw new ServerError(404, 'Version is not installed');
	await rm(join(server.directory, 'versions', branch, version), { recursive: true });
}
