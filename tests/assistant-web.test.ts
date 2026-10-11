import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import {
	fetchPublicWeb,
	publicWebAddress,
	publicWebUrl,
	selectWebBlueprint,
	webPageText
} from '../src/lib/server/assistant-web';

const encode = (value: unknown) => `0${deflateSync(JSON.stringify(value)).toString('base64')}`;
test('web access rejects local networks, metadata addresses and credential-bearing URLs', async () => {
	for (const address of [
		'127.0.0.1',
		'10.0.0.1',
		'172.16.4.1',
		'192.168.1.1',
		'169.254.169.254',
		'100.100.100.200',
		'192.0.2.1',
		'::1',
		'fc00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
		'2001:db8::1'
	])
		assert.equal(publicWebAddress(address), false, address);
	for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
		assert.equal(publicWebAddress(address), true, address);
	for (const url of [
		'http://example.com',
		'https://user:secret@example.com',
		'https://example.com:8443',
		'file:///etc/passwd'
	])
		assert.throws(() => publicWebUrl(url));
	await assert.rejects(fetchPublicWeb('https://127.0.0.1'), /Private network/);
});
test('blueprint book selection preserves complete settings without constructing or dropping them', () => {
	const blueprint = {
		label: 'Platform',
		version: 562954953031680,
		entities: [
			{
				entity_number: 1,
				name: 'asteroid-collector',
				position: { x: 0.5, y: 0.5 },
				control_behavior: { filters: [{ index: 1, name: 'metallic-asteroid-chunk' }] },
				items: [
					{
						id: { name: 'speed-module' },
						items: { in_inventory: [{ inventory: 1, stack: 0, count: 1 }] }
					}
				]
			}
		],
		tiles: [{ name: 'space-platform-foundation', position: { x: 0, y: 0 } }],
		wires: [[1, 1, 2, 1]]
	};
	const encoded = encode({
		blueprint_book: { label: 'Book', blueprints: [{ index: 7, blueprint }] }
	});
	assert.deepEqual(selectWebBlueprint(encoded, []), {
		book: 'Book',
		entries: [{ index: 7, label: 'Platform' }],
		total: 1
	});
	const selected = selectWebBlueprint(encoded, [7]);
	assert.ok('blueprint' in selected);
	if (!('blueprint' in selected)) throw new Error('Expected blueprint');
	assert.deepEqual(selected.blueprint, blueprint);
	assert.deepEqual(selectWebBlueprint(selected.string, []), selected);
	assert.throws(() => selectWebBlueprint(encoded, [8]), /not found/);
	assert.throws(
		() => selectWebBlueprint(encode({ blueprint: { entities: [], tiles: [] } }), []),
		/Empty/
	);
	assert.throws(() => selectWebBlueprint(`0${'A'.repeat(1024 * 1024 + 1)}`, []), /oversized/);
});
test('web page extraction removes executable content and bounds source text', () => {
	assert.equal(
		webPageText('<p>Source &amp; facts</p><script>bad()</script><style>bad</style>'),
		'Source & facts'
	);
	assert.equal(webPageText('x'.repeat(17000)).length, 16000);
});
