import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '$env/dynamic/private';
import { compareVersions } from '$lib/dependencies';
import { validModName } from '$lib/server/mod-names';
import type { PortalRelease } from '$lib/server/portal-cache';
import { factorioApiLimiter } from '$lib/server/rate-limiter';

const pending = new Map<string, Promise<{ path: string; size: number }>>();
const verified = new Map<string, { size: number; mtime: number }>();
async function checksum(path: string) {
	const hash = createHash('sha1');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

// Cache immutable release archives across users and restarts. Rename only after checksum verification.
export async function modArchive(
	name: string,
	release: PortalRelease,
	account: { username: string; token: string } | null
) {
	if (
		!validModName(name) ||
		compareVersions(release.version, release.version) === null ||
		!release.sha1 ||
		!/^[a-f0-9]{40}$/iu.test(release.sha1) ||
		!release.download_url
	)
		throw new Error('Release download metadata is incomplete');
	const sha1 = release.sha1.toLowerCase();
	const directory = join(env.FACMANDU_CACHE_DIR || '.cache/facmandu', 'mods');
	const path = join(directory, `${name}_${release.version}_${sha1}.zip`);
	const cached = await stat(path).catch(() => null);
	if (cached) {
		const known = verified.get(path);
		if (
			(known?.size === cached.size && known.mtime === cached.mtimeMs) ||
			(await checksum(path)) === sha1
		) {
			verified.set(path, { size: cached.size, mtime: cached.mtimeMs });
			return { path, size: cached.size };
		}
	}
	let request = pending.get(path);
	if (!request) {
		if (!account)
			throw new Error('Add Factorio credentials in account settings to download uncached mods');
		const url = new URL(release.download_url, 'https://mods.factorio.com');
		if (url.origin !== 'https://mods.factorio.com' || !url.pathname.startsWith('/download/'))
			throw new Error('Invalid mod download path');
		url.searchParams.set('username', account.username);
		url.searchParams.set('token', account.token);
		request = (async () => {
			await mkdir(directory, { recursive: true });
			const temporary = `${path}.${randomUUID()}.part`;
			try {
				let response: Response;
				try {
					response = await factorioApiLimiter.fetch(url.toString(), {
						signal: AbortSignal.timeout(180_000)
					});
				} catch {
					throw new Error(`Download request failed for ${name}`);
				}
				if (!response.ok || !response.body)
					throw new Error(`Download of ${name} returned HTTP ${response.status}`);
				await pipeline(response.body, createWriteStream(temporary));
				if ((await checksum(temporary)) !== sha1)
					throw new Error(`Download checksum mismatch for ${name}`);
				await rename(temporary, path);
				const info = await stat(path);
				verified.set(path, { size: info.size, mtime: info.mtimeMs });
				return { path, size: info.size };
			} finally {
				await rm(temporary, { force: true });
			}
		})().finally(() => pending.delete(path));
		pending.set(path, request);
	}
	return request;
}
