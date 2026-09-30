import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { env } from '$env/dynamic/private';
import { compareVersions, isBundledMod } from '$lib/dependencies';
import { createModList } from '$lib/mod-list';
import { publishActivity } from '$lib/server/activity';
import { modArchive } from '$lib/server/mod-downloads';
import { validModName } from '$lib/server/mod-names';
import { getPortalMod } from '$lib/server/portal-cache';

type ExportMod = { name: string; version: string | null; enabled: boolean | null };
export type ExportProgress = {
	id: string;
	listId: string;
	state: 'running' | 'done' | 'error';
	message: string;
	completed: number;
	total: number;
};
const jobs = new Map<string, ExportProgress>();
const encoder = new TextEncoder();
const blockSize = 512;
const directory = () => join(env.FACMANDU_CACHE_DIR || '.cache/facmandu', 'exports');
export const exportPath = (id: string) => join(directory(), `${id}.tar.gz`);
export const exportProgress = (id: string) => jobs.get(id);

function tarHeader(name: string, size: number, type = '0') {
	const header = new Uint8Array(blockSize);
	const write = (offset: number, length: number, value: string) =>
		header.set(encoder.encode(value).slice(0, length), offset);
	const octal = (value: number, length: number) =>
		`${value.toString(8).padStart(length - 1, '0')}\0`;
	write(0, 100, name);
	write(100, 8, octal(0o644, 8));
	write(108, 8, octal(0, 8));
	write(116, 8, octal(0, 8));
	write(124, 12, octal(size, 12));
	write(136, 12, octal(0, 12));
	header.fill(32, 148, 156);
	write(156, 1, type);
	write(257, 6, 'ustar\0');
	write(263, 2, '00');
	write(
		148,
		8,
		`${header
			.reduce((sum, byte) => sum + byte, 0)
			.toString(8)
			.padStart(6, '0')}\0 `
	);
	return header;
}
function* padding(size: number) {
	const count = (blockSize - (size % blockSize)) % blockSize;
	if (count) yield new Uint8Array(count);
}
function* entry(name: string, contents: Uint8Array, type = '0') {
	yield tarHeader(name, contents.byteLength, type);
	yield contents;
	yield* padding(contents.byteLength);
}

export async function prepareExport(
	listId: string,
	mods: ExportMod[],
	account: { username: string; token: string } | null
) {
	const selected = mods
		.filter((mod) => mod.name !== 'base' && (mod.enabled || isBundledMod(mod.name)))
		.toSorted((a, b) => a.name.localeCompare(b.name));
	for (const mod of selected) {
		if (
			!validModName(mod.name) ||
			(!isBundledMod(mod.name) &&
				(!mod.version || compareVersions(mod.version, mod.version) === null))
		) {
			throw new Error(`Repair the metadata for ${mod.name} before exporting`);
		}
	}
	const id = createHash('sha256')
		.update(JSON.stringify({ format: 2, listId, selected }))
		.digest('hex');
	const existing = jobs.get(id);
	if (existing?.state === 'running') return existing;
	const total = selected.filter((mod) => !isBundledMod(mod.name)).length + 1;
	const report = (state: ExportProgress['state'], message: string, completed: number) => {
		const progress = { id, listId, state, message, completed, total };
		jobs.set(id, progress);
		if (jobs.size > 100) {
			const finished = [...jobs].find(([, job]) => job.state !== 'running');
			if (finished) jobs.delete(finished[0]);
		}
		publishActivity({
			scope: 'modlist',
			targetId: listId,
			task: 'export',
			...progress,
			...(state === 'done'
				? { download: `/api/modlists/${encodeURIComponent(listId)}/export?download=${id}` }
				: {})
		});
		return progress;
	};
	if (await stat(exportPath(id)).catch(() => null))
		return report('done', 'Mod bundle ready to download', total);
	const active = jobs.get(id);
	if (active?.state === 'running') return active;
	const progress = report('running', 'Preparing mod bundle', 0);
	void (async () => {
		const temporary = `${exportPath(id)}.${randomUUID()}.part`;
		try {
			await mkdir(directory(), { recursive: true });
			const downloads: { name: string; path: string; size: number }[] = [];
			for (const mod of selected) {
				if (isBundledMod(mod.name)) continue;
				report('running', `Preparing ${mod.name}`, downloads.length);
				const { data } = await getPortalMod(mod.name);
				const release = data?.releases.find((item) => item.version === mod.version);
				if (!release)
					throw new Error(`Release metadata for ${mod.name} is unavailable; repair the list first`);
				const archive = await modArchive(mod.name, release, account);
				if (archive.size > 8_589_934_591)
					throw new Error(`${mod.name} is too large for this archive`);
				downloads.push({ name: `${mod.name}_${release.version}.zip`, ...archive });
			}
			report('running', 'Packaging mod bundle', downloads.length);
			async function* entries(): AsyncGenerator<Uint8Array> {
				yield* entry(
					'mod-list.json',
					encoder.encode(JSON.stringify(createModList(selected), null, 2))
				);
				for (const download of downloads) {
					// GNU long names preserve valid mod identifiers beyond the tar header's 100-byte field.
					if (encoder.encode(download.name).byteLength > 100)
						yield* entry('././@LongLink', encoder.encode(`${download.name}\0`), 'L');
					yield tarHeader(download.name, download.size);
					for await (const chunk of createReadStream(download.path)) yield chunk;
					yield* padding(download.size);
				}
				yield new Uint8Array(blockSize * 2);
			}
			// Mod zips are already compressed; avoid spending CPU recompressing them.
			await pipeline(
				Readable.from(entries()),
				createGzip({ level: 1 }),
				createWriteStream(temporary)
			);
			await rename(temporary, exportPath(id));
			report('done', 'Mod bundle ready to download', total);
		} catch (cause) {
			report(
				'error',
				cause instanceof Error ? cause.message : 'Could not prepare mod bundle',
				jobs.get(id)?.completed ?? 0
			);
		} finally {
			await rm(temporary, { force: true }).catch(() => {});
		}
	})();
	return progress;
}
