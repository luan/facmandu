// Factorio's mod-settings.dat property tree. Keep decoded bytes on each node so
// patching one setting does not re-encode unrelated values or metadata.
export const settingSections = ['startup', 'runtime-global', 'runtime-per-user'] as const;
export type SettingSection = (typeof settingSections)[number];
export type SettingValue =
	| boolean
	| number
	| string
	| { r: number; g: number; b: number; a?: number };

type Entry = { readonly key: string; readonly node: PropertyNode; readonly keyBytes?: Buffer };
export type PropertyNode =
	| { readonly kind: 'none'; readonly flag: number; readonly raw?: Buffer }
	| { readonly kind: 'bool'; readonly flag: number; readonly value: boolean; readonly raw?: Buffer }
	| {
			readonly kind: 'number';
			readonly flag: number;
			readonly value: number;
			readonly raw?: Buffer;
	  }
	| {
			readonly kind: 'string';
			readonly flag: number;
			readonly value: string | null;
			readonly raw?: Buffer;
	  }
	| {
			readonly kind: 'list';
			readonly flag: number;
			readonly entries: readonly Entry[];
			readonly raw?: Buffer;
	  }
	| {
			readonly kind: 'dictionary';
			readonly flag: number;
			readonly entries: readonly Entry[];
			readonly raw?: Buffer;
	  }
	| {
			readonly kind: 'signed';
			readonly flag: number;
			readonly value: bigint;
			readonly raw?: Buffer;
	  }
	| {
			readonly kind: 'unsigned';
			readonly flag: number;
			readonly value: bigint;
			readonly raw?: Buffer;
	  };

export type ModSettingsDocument = {
	readonly version: readonly [number, number, number, number];
	readonly root: PropertyNode;
	readonly header?: Buffer;
};

const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 100_000;
const utf8 = new TextDecoder('utf-8', { fatal: true });

class Reader {
	position = 0;
	nodes = 0;
	constructor(readonly input: Buffer) {
		if (input.length > MAX_BYTES) throw new Error('mod-settings.dat exceeds 1 MiB');
	}
	bytes(length: number): Buffer {
		if (!Number.isSafeInteger(length) || length < 0 || length > this.input.length - this.position)
			throw new Error('Truncated mod-settings.dat');
		const bytes = this.input.subarray(this.position, this.position + length);
		this.position += length;
		return bytes;
	}
	u8(): number {
		return this.bytes(1).readUInt8();
	}
	u32(): number {
		const bytes = this.bytes(4);
		return bytes.readUInt32LE();
	}
	string(): string | null {
		const absent = this.u8();
		if (absent === 1) return null;
		if (absent !== 0) throw new Error('Invalid property string flag');
		const small = this.u8();
		const length = small === 255 ? this.u32() : small;
		return utf8.decode(this.bytes(length));
	}
	node(depth = 0): PropertyNode {
		if (depth > MAX_DEPTH || ++this.nodes > MAX_NODES)
			throw new Error('Property tree limit exceeded');
		const start = this.position;
		const type = this.u8();
		const flag = this.u8();
		let node: PropertyNode;
		switch (type) {
			case 0:
				node = { kind: 'none', flag };
				break;
			case 1: {
				const value = this.u8();
				node = { kind: 'bool', flag, value: value === 1 };
				break;
			}
			case 2:
				node = { kind: 'number', flag, value: this.bytes(8).readDoubleLE() };
				break;
			case 3:
				node = { kind: 'string', flag, value: this.string() };
				break;
			case 4:
			case 5: {
				const count = this.u32();
				if (count > MAX_NODES - this.nodes || count > (this.input.length - this.position) / 3)
					throw new Error('Property tree count exceeds available data');
				const entries: Entry[] = [];
				const names = new Set<string>();
				for (let i = 0; i < count; i++) {
					const keyStart = this.position;
					const key = this.string();
					if (key === null) throw new Error('Null property key');
					if (type === 5 && names.has(key)) throw new Error(`Duplicate property key: ${key}`);
					names.add(key);
					const keyBytes = this.input.subarray(keyStart, this.position);
					entries.push({ key, keyBytes, node: this.node(depth + 1) });
				}
				node = type === 4 ? { kind: 'list', flag, entries } : { kind: 'dictionary', flag, entries };
				break;
			}
			case 6:
				node = { kind: 'signed', flag, value: this.bytes(8).readBigInt64LE() };
				break;
			case 7:
				node = { kind: 'unsigned', flag, value: this.bytes(8).readBigUInt64LE() };
				break;
			default:
				throw new Error(`Unknown property tree type: ${type}`);
		}
		return { ...node, raw: this.input.subarray(start, this.position) };
	}
}

function dictionary(
	node: PropertyNode,
	label: string
): Extract<PropertyNode, { kind: 'dictionary' }> {
	if (node.kind !== 'dictionary') throw new Error(`${label} must be a dictionary`);
	return node;
}

function find(
	node: Extract<PropertyNode, { kind: 'dictionary' }>,
	key: string
): PropertyNode | undefined {
	return node.entries.find((entry) => entry.key === key)?.node;
}

function sections(
	root: PropertyNode
): Record<SettingSection, Extract<PropertyNode, { kind: 'dictionary' }>> {
	const top = dictionary(root, 'mod settings root');
	return {
		startup: dictionary(required(find(top, 'startup'), 'startup'), 'startup'),
		'runtime-global': dictionary(
			required(find(top, 'runtime-global'), 'runtime-global'),
			'runtime-global'
		),
		'runtime-per-user': dictionary(
			required(find(top, 'runtime-per-user'), 'runtime-per-user'),
			'runtime-per-user'
		)
	};
}

function required<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Missing ${label} section`);
	return value;
}

export function decodeModSettings(input: Buffer): ModSettingsDocument {
	const reader = new Reader(input);
	const header = reader.bytes(9);
	if (header[8] !== 0) throw new Error('Invalid mod settings header flag');
	const version = [0, 2, 4, 6].map((offset) => header.readUInt16LE(offset)) as [
		number,
		number,
		number,
		number
	];
	const root = reader.node();
	if (reader.position !== input.length) throw new Error('Trailing mod settings data');
	sections(root);
	return { version, header, root };
}

function u8(value: number): Buffer {
	return Buffer.from([value]);
}
function u32(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value);
	return buffer;
}
function string(value: string | null): Buffer {
	if (value === null) return u8(1);
	const bytes = Buffer.from(value, 'utf8');
	return Buffer.concat([
		u8(0),
		bytes.length < 255 ? u8(bytes.length) : Buffer.concat([u8(255), u32(bytes.length)]),
		bytes
	]);
}

function encodeNode(node: PropertyNode, depth: number, counter: { nodes: number }): Buffer {
	if (depth > MAX_DEPTH || ++counter.nodes > MAX_NODES)
		throw new Error('Property tree limit exceeded');
	if (node.raw) return node.raw;
	const type = {
		none: 0,
		bool: 1,
		number: 2,
		string: 3,
		list: 4,
		dictionary: 5,
		signed: 6,
		unsigned: 7
	}[node.kind];
	const pieces = [u8(type), u8(node.flag)];
	switch (node.kind) {
		case 'none':
			break;
		case 'bool':
			pieces.push(u8(node.value ? 1 : 0));
			break;
		case 'number': {
			const buffer = Buffer.alloc(8);
			buffer.writeDoubleLE(node.value);
			pieces.push(buffer);
			break;
		}
		case 'string':
			pieces.push(string(node.value));
			break;
		case 'signed': {
			const buffer = Buffer.alloc(8);
			buffer.writeBigInt64LE(node.value);
			pieces.push(buffer);
			break;
		}
		case 'unsigned': {
			const buffer = Buffer.alloc(8);
			buffer.writeBigUInt64LE(node.value);
			pieces.push(buffer);
			break;
		}
		case 'list':
		case 'dictionary':
			pieces.push(u32(node.entries.length));
			for (const entry of node.entries) {
				pieces.push(entry.keyBytes ?? string(entry.key));
				pieces.push(encodeNode(entry.node, depth + 1, counter));
			}
	}
	return Buffer.concat(pieces);
}

export function encodeModSettings(document: ModSettingsDocument): Buffer {
	sections(document.root);
	const header =
		document.header ??
		(() => {
			const bytes = Buffer.alloc(9);
			for (const [index, part] of document.version.entries()) bytes.writeUInt16LE(part, index * 2);
			return bytes;
		})();
	const output = Buffer.concat([header, encodeNode(document.root, 0, { nodes: 0 })]);
	if (output.length > MAX_BYTES) throw new Error('mod-settings.dat exceeds 1 MiB');
	return output;
}

function dict(entries: readonly Entry[] = []): PropertyNode {
	return { kind: 'dictionary', flag: 0, entries };
}

export function createModSettings(version: string): ModSettingsDocument {
	if (!/^\d+\.\d+(?:\.\d+){0,2}$/.test(version)) throw new Error('Invalid Factorio version');
	const parts = version.split('.').map(Number);
	const [major, minor, patch = 0, build = 0] = parts;
	if (
		major === undefined ||
		minor === undefined ||
		parts.length > 4 ||
		parts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)
	)
		throw new Error('Invalid Factorio version');
	return {
		version: [major, minor, patch, build],
		root: dict(settingSections.map((key) => ({ key, node: dict() })))
	};
}

function readValue(node: PropertyNode): SettingValue | undefined {
	switch (node.kind) {
		case 'bool':
		case 'string':
			return node.value ?? undefined;
		case 'number':
			return Number.isFinite(node.value) ? node.value : undefined;
		case 'signed':
		case 'unsigned':
			return node.value >= BigInt(Number.MIN_SAFE_INTEGER) &&
				node.value <= BigInt(Number.MAX_SAFE_INTEGER)
				? Number(node.value)
				: undefined;
		case 'dictionary': {
			const channels: Record<string, number | undefined> = Object.fromEntries(
				node.entries.map(({ key, node: child }) => [
					key,
					child.kind === 'number' ? child.value : undefined
				])
			);
			if (
				channels.r === undefined ||
				!Number.isFinite(channels.r) ||
				channels.g === undefined ||
				!Number.isFinite(channels.g) ||
				channels.b === undefined ||
				!Number.isFinite(channels.b)
			)
				return undefined;
			if (channels.a !== undefined && !Number.isFinite(channels.a)) return undefined;
			return {
				r: channels.r,
				g: channels.g,
				b: channels.b,
				...(typeof channels.a === 'number' ? { a: channels.a } : {})
			};
		}
		default:
			return undefined;
	}
}

export function getModSettingValues(
	document: ModSettingsDocument
): Record<SettingSection, Record<string, SettingValue>> {
	const result: Record<SettingSection, Record<string, SettingValue>> = {
		startup: {},
		'runtime-global': {},
		'runtime-per-user': {}
	};
	for (const section of settingSections) {
		for (const entry of sections(document.root)[section].entries) {
			if (entry.node.kind !== 'dictionary') continue;
			const value = find(entry.node, 'value');
			const simple = value && readValue(value);
			if (simple !== undefined) result[section][entry.key] = simple;
		}
	}
	return result;
}

function writeValue(value: SettingValue, previous?: PropertyNode): PropertyNode {
	const flag = previous?.flag ?? 0;
	if (typeof value === 'boolean') return { kind: 'bool', flag, value };
	if (typeof value === 'string') return { kind: 'string', flag, value };
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Setting number must be finite');
		if (previous?.kind === 'signed' && Number.isSafeInteger(value))
			return { kind: 'signed', flag, value: BigInt(value) };
		if (previous?.kind === 'unsigned' && Number.isSafeInteger(value) && value >= 0)
			return { kind: 'unsigned', flag, value: BigInt(value) };
		return { kind: 'number', flag, value };
	}
	const oldColor = previous?.kind === 'dictionary' ? previous : dict();
	let result = oldColor;
	for (const key of ['r', 'g', 'b', 'a'] as const) {
		const channel = value[key];
		if (channel === undefined) continue;
		if (!Number.isFinite(channel)) throw new Error('Setting color channel must be finite');
		result = replace(result, key, {
			kind: 'number',
			flag: find(dictionary(result, 'color'), key)?.flag ?? 0,
			value: channel
		});
	}
	return result;
}

function replace(node: PropertyNode, key: string, value: PropertyNode): PropertyNode {
	const parent = dictionary(node, key);
	const old = parent.entries.find((entry) => entry.key === key);
	const entries = old
		? parent.entries.map((entry) => (entry === old ? { ...entry, node: value } : entry))
		: [...parent.entries, { key, node: value }];
	return { kind: 'dictionary', flag: parent.flag, entries };
}

export function updateModSettingValues(
	document: ModSettingsDocument,
	changes: Partial<Record<SettingSection, Record<string, SettingValue>>>
): ModSettingsDocument {
	let root = document.root;
	for (const section of settingSections) {
		for (const [name, value] of Object.entries(changes[section] ?? {})) {
			if (!name) throw new Error('Setting name must not be empty');
			const currentSection = dictionary(
				required(find(dictionary(root, 'root'), section), section),
				section
			);
			const previous = find(currentSection, name);
			if (previous && previous.kind !== 'dictionary')
				throw new Error(`Setting ${name} is not a dictionary`);
			const setting = previous ?? dict();
			const updated = replace(
				setting,
				'value',
				writeValue(value, find(dictionary(setting, name), 'value'))
			);
			root = replace(root, section, replace(currentSection, name, updated));
		}
	}
	return { ...document, root };
}
