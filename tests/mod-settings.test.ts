import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createModSettings,
	decodeModSettings,
	encodeModSettings,
	getModSettingValues,
	type ModSettingsDocument,
	type PropertyNode,
	updateModSettingValues
} from '../src/lib/mod-settings';

test('empty settings use the documented header and three dictionary sections', () => {
	const encoded = encodeModSettings(createModSettings('2.1.20.4'));
	assert.equal(encoded.subarray(0, 17).toString('hex'), '0200010014000400000500030000000007');
	assert.deepEqual(decodeModSettings(encoded).version, [2, 1, 20, 4]);
	assert.deepEqual(getModSettingValues(decodeModSettings(encoded)), {
		startup: {},
		'runtime-global': {},
		'runtime-per-user': {}
	});
});

test('patches values without losing flags, unknown fields, 64-bit integers, or section order', () => {
	const original = createModSettings('2.1.20.4');
	const sections = (original.root as Extract<PropertyNode, { kind: 'dictionary' }>).entries;
	const document: ModSettingsDocument = {
		...original,
		root: {
			kind: 'dictionary',
			flag: 7,
			entries: [
				{
					key: 'future-section',
					node: {
						kind: 'list',
						flag: 19,
						entries: [
							{ key: '', node: { kind: 'unsigned', flag: 23, value: 18446744073709551615n } },
							{ key: '', node: { kind: 'none', flag: 31 } }
						]
					}
				},
				...sections
			]
		}
	};
	const withValues = updateModSettingValues(document, {
		startup: { speed: 12.5, tint: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
		'runtime-global': { enabled: true },
		'runtime-per-user': { label: 'héllo' }
	});
	const before = encodeModSettings(withValues);
	assert.deepEqual(encodeModSettings(decodeModSettings(before)), before);
	const patched = updateModSettingValues(decodeModSettings(before), { startup: { speed: 13 } });
	const after = decodeModSettings(encodeModSettings(patched));
	assert.deepEqual(getModSettingValues(after), {
		startup: { speed: 13, tint: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
		'runtime-global': { enabled: true },
		'runtime-per-user': { label: 'héllo' }
	});
	const unknown = (after.root as Extract<PropertyNode, { kind: 'dictionary' }>).entries[0]?.node;
	assert.equal(unknown?.kind, 'list');
	assert.equal(unknown?.flag, 19);
	if (unknown?.kind !== 'list') throw new Error('Expected list');
	assert.deepEqual(unknown.entries[0]?.node, {
		kind: 'unsigned',
		flag: 23,
		value: 18446744073709551615n,
		raw: unknown.entries[0]?.node.raw
	});
	assert.deepEqual(
		unknown.raw,
		(decodeModSettings(before).root as Extract<PropertyNode, { kind: 'dictionary' }>).entries[0]
			?.node.raw
	);
});

test('rejects truncated, trailing, oversized, and unknown property data', () => {
	const valid = encodeModSettings(createModSettings('2.1.20.4'));
	for (let length = 0; length < valid.length; length++) {
		assert.throws(() => decodeModSettings(valid.subarray(0, length)));
	}
	assert.throws(() => decodeModSettings(Buffer.concat([valid, Buffer.from([0])])), /Trailing/);
	assert.throws(() => decodeModSettings(Buffer.alloc(1024 * 1024 + 1)), /1 MiB/);
	const unknown = Buffer.from(valid);
	unknown[9] = 8;
	assert.throws(() => decodeModSettings(unknown), /Unknown property/);
	const badFlag = Buffer.from(valid);
	badFlag[8] = 1;
	assert.throws(() => decodeModSettings(badFlag), /header flag/);
});
