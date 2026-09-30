import type { Dirent } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { validModName } from './mod-names';
import type { SettingDef } from './mod-settings-lua';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_LOCALE_BYTES = 1024 * 1024;
const MAX_TOTAL_LOCALE_BYTES = 4 * 1024 * 1024;
const MAX_LOCALE_FILES = 128;
const MAX_LOCALISED_DEPTH = 20;
const MAX_PARAMETERS = 20;
const MAX_CACHED_ARCHIVES = 256;
const MAX_CACHED_LOCALE_BYTES = 32 * 1024 * 1024;

type LocaleTable = Map<string, string>;
const archiveCache = new Map<string, { signature: string; table: LocaleTable; bytes: number }>();
let cachedLocaleBytes = 0;

async function readBounded(path: string, limit: number): Promise<Buffer> {
	const file = await open(path, 'r');
	try {
		const size = (await file.stat()).size;
		if (size > limit) throw new Error('Locale source exceeds size limit');
		const buffer = Buffer.alloc(size);
		let offset = 0;
		while (offset < size) {
			const { bytesRead } = await file.read(buffer, offset, size - offset, offset);
			if (bytesRead === 0) throw new Error('Locale source changed during read');
			offset += bytesRead;
		}
		return buffer;
	} finally {
		await file.close();
	}
}

function parseCfg(text: string, table: LocaleTable): void {
	let section = '';
	for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const line = raw.replace(/\r$/, '');
		if (!line || line.startsWith('#') || line.startsWith(';')) continue;
		if (line.startsWith('[') && line.endsWith(']')) {
			section = line.slice(1, -1);
			continue;
		}
		const separator = line.indexOf('=');
		if (separator < 0 || !section) continue;
		const key = line.slice(0, separator);
		if (key) table.set(`${section}.${key}`, line.slice(separator + 1).replace(/\\n/g, '\n'));
	}
}

function localePath(path: string, name: string): boolean {
	const parts = path.split('/');
	const locale = parts.length === 3 ? 0 : parts.length === 4 ? 1 : -1;
	if (locale < 0 || (locale === 1 && parts[0] !== name && !parts[0]?.startsWith(`${name}_`)))
		return false;
	return (
		parts[locale] === 'locale' &&
		parts[locale + 1] === 'en' &&
		/^[^/]+\.cfg$/i.test(parts[locale + 2] ?? '')
	);
}

async function readUnpackedLocale(modsDirectory: string, name: string): Promise<LocaleTable> {
	const table: LocaleTable = new Map();
	const directory = join(modsDirectory, name, 'locale', 'en');
	let files: Dirent[];
	try {
		files = await readdir(directory, { withFileTypes: true });
	} catch {
		return table;
	}
	const cfgFiles = files
		.filter((entry) => entry.isFile() && entry.name.endsWith('.cfg'))
		.sort((a, b) => a.name.localeCompare(b.name));
	let total = 0;
	for (const entry of cfgFiles.slice(0, MAX_LOCALE_FILES)) {
		try {
			const bytes = await readBounded(
				join(directory, entry.name),
				Math.min(MAX_LOCALE_BYTES, MAX_TOTAL_LOCALE_BYTES - total)
			);
			total += bytes.length;
			parseCfg(bytes.toString('utf8'), table);
		} catch {
			/* A broken locale file must not hide the mod's settings. */
		}
	}
	return table;
}

async function readLocale(
	modsDirectory: string,
	name: string,
	version: string
): Promise<LocaleTable> {
	if (version === 'unpacked') return readUnpackedLocale(modsDirectory, name);
	const path = join(modsDirectory, `${name}_${version}.zip`);
	let signature: string;
	try {
		const info = await stat(path, { bigint: true });
		if (info.size > BigInt(MAX_ARCHIVE_BYTES)) return new Map();
		signature = `${info.size}:${info.mtimeNs}`;
	} catch {
		return readUnpackedLocale(modsDirectory, name);
	}
	const cached = archiveCache.get(path);
	if (cached?.signature === signature) return cached.table;
	if (cached) {
		archiveCache.delete(path);
		cachedLocaleBytes -= cached.bytes;
	}

	let archive: Buffer;
	try {
		archive = await readBounded(path, MAX_ARCHIVE_BYTES);
	} catch {
		return new Map();
	}
	const table: LocaleTable = new Map();
	let count = 0;
	let total = 0;
	try {
		// fflate inspects the ZIP directory first; assets never get inflated.
		const files = unzipSync(archive, {
			filter: (entry) => {
				if (!localePath(entry.name, name)) return false;
				if (
					entry.originalSize > MAX_LOCALE_BYTES ||
					++count > MAX_LOCALE_FILES ||
					total + entry.originalSize > MAX_TOTAL_LOCALE_BYTES
				)
					return false;
				total += entry.originalSize;
				return true;
			}
		});
		for (const path of Object.keys(files).sort()) {
			const bytes = files[path];
			if (bytes) parseCfg(Buffer.from(bytes).toString('utf8'), table);
		}
	} catch {
		/* A broken archive gets readable fallback labels. */
	}
	archiveCache.set(path, { signature, table, bytes: total });
	cachedLocaleBytes += total;
	// Ordinary large catalogs exceed 150 mods. Bound both count and locale data.
	while (archiveCache.size > MAX_CACHED_ARCHIVES || cachedLocaleBytes > MAX_CACHED_LOCALE_BYTES) {
		const oldest = archiveCache.keys().next().value;
		if (oldest === undefined) break;
		const evicted = archiveCache.get(oldest);
		archiveCache.delete(oldest);
		cachedLocaleBytes -= evicted?.bytes ?? 0;
	}
	return table;
}

function humanize(value: string): string {
	const tail = value.includes('.') ? value.slice(value.lastIndexOf('.') + 1) : value;
	const words = tail
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

function plain(text: string): string {
	return text
		.replace(/\[(?:item|entity|fluid|recipe|technology|tile)=([^\]]+)\]/g, (_tag, name: string) =>
			humanize(name)
		)
		.replace(/\[\/?[a-z][^\]]*\]/gi, '');
}

function bounded(text: string, max: number): string {
	const result = text.slice(0, max);
	return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
}

function expand(text: string, table: LocaleTable, parameters: readonly string[]): string {
	return text
		.replace(
			/__(ITEM|ENTITY|FLUID|PLANET|TILE|RECIPE|TECHNOLOGY)__([^_]+(?:_[^_]+)*)__/g,
			(_whole, kind: string, name: string) => {
				const category = {
					ITEM: 'item-name',
					ENTITY: 'entity-name',
					FLUID: 'fluid-name',
					PLANET: 'space-location-name',
					TILE: 'tile-name',
					RECIPE: 'recipe-name',
					TECHNOLOGY: 'technology-name'
				}[kind as 'ITEM' | 'ENTITY' | 'FLUID' | 'PLANET' | 'TILE' | 'RECIPE' | 'TECHNOLOGY'];
				return category ? (table.get(`${category}.${name}`) ?? humanize(name)) : humanize(name);
			}
		)
		.replace(
			/__ALT_CONTROL__(\d+)__([^_]+(?:_[^_]+)*)__/g,
			(_whole, form: string, name: string) => `${humanize(name)} control (alternate ${form})`
		)
		.replace(
			/__CONTROL(?:_MODIFIER)?__([^_]+(?:_[^_]+)*)__/g,
			(_whole, name: string) => `${humanize(name)} control`
		)
		.replace(/__CONTROL_LEFT_CLICK__/g, 'left click')
		.replace(/__CONTROL_RIGHT_CLICK__/g, 'right click')
		.replace(/__ALT_CONTROL_LEFT_CLICK__(\d+)__/g, 'left click')
		.replace(/__ALT_CONTROL_RIGHT_CLICK__(\d+)__/g, 'right click')
		.replace(/__CONTROL_KEY_SHIFT__/g, 'Shift key')
		.replace(/__CONTROL_KEY_CTRL__/g, 'Control key')
		.replace(/__CONTROL_MOVE__/g, 'movement controls')
		.replace(/__(?:CONTROL_STYLE|REMARK_COLOR)_(?:BEGIN|END)__/g, '')
		.replace(/__(\d+)__/g, (_whole, number: string) => parameters[Number(number) - 1] ?? '');
}

function resolveLocalised(value: unknown, table: LocaleTable, depth = 0): string | null {
	if (depth > MAX_LOCALISED_DEPTH) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		typeof value[0] !== 'string' ||
		value.length - 1 > MAX_PARAMETERS
	)
		return null;
	const [key, ...args]: unknown[] = value;
	if (typeof key !== 'string') return null;
	if (key === '?') {
		for (const arg of args) {
			const result = resolveLocalised(arg, table, depth + 1);
			if (result !== null) return result;
		}
		return null;
	}
	const parts = args.map((arg) => resolveLocalised(arg, table, depth + 1));
	if (parts.some((part) => part === null)) return null;
	if (key === '') return parts.join('');
	const template = table.get(key);
	return template === undefined ? null : expand(template, table, parts as string[]);
}

function resolveText(custom: unknown, key: string, table: LocaleTable): string | null {
	const direct = resolveLocalised(custom, table);
	if (direct !== null) return expand(direct, table, []);
	const conventional = table.get(key);
	return conventional === undefined ? null : expand(conventional, table, []);
}

export async function resolveModSettingLocale(
	modsDirectory: string,
	name: string,
	version: string,
	defs: SettingDef[]
): Promise<SettingDef[]> {
	if (defs.length === 0) return defs;
	if (!validModName(name) || (version !== 'unpacked' && !/^\d+(?:\.\d+){1,3}$/.test(version)))
		throw new Error('Invalid mod locale source');
	const table = await readLocale(modsDirectory, name, version);
	return defs.map((def) => {
		const label = bounded(
			plain(
				resolveText(def.localisedName, `mod-setting-name.${def.name}`, table) ?? humanize(def.name)
			),
			256
		);
		const description = resolveText(
			def.localisedDescription,
			`mod-setting-description.${def.name}`,
			table
		);
		const allowedLabels: Record<string, string> = Object.fromEntries(
			(def.allowed ?? []).map((option) => {
				const key = String(option);
				const translated =
					resolveText(undefined, `string-mod-setting.${def.name}-${key}`, table) ?? humanize(key);
				return [key, bounded(plain(translated).trim(), 256)];
			})
		);
		return {
			...def,
			label: label || bounded(humanize(def.name), 256),
			description: description ? bounded(description, 4096) : undefined,
			allowedLabels: def.allowed ? allowedLabels : undefined
		};
	});
}
