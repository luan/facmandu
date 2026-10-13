import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import {
	fetchPublicWeb,
	publicWebAddress,
	publicWebUrl,
	searchFactoryBlueprints,
	selectWebBlueprint,
	sharedBlueprint,
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

test('Codex factory search returns component links and explicitly theoretical rates', async () => {
	const result = await searchFactoryBlueprints(['coal'], ['plastic-bar'], (address) => {
		const url = new URL(address);
		assert.equal(url.origin, 'https://www.factoriocodex.com');
		assert.equal(url.pathname, '/api/v1/blueprints/components/search');
		assert.equal(url.searchParams.get('i'), 'coal');
		assert.equal(url.searchParams.get('o'), 'plastic-bar');
		assert.equal(url.searchParams.get('o_mode'), 'AND');
		assert.equal(url.searchParams.get('per_page'), '8');
		return JSON.stringify({
			total: 85,
			data: [
				{
					id: 22921,
					blueprint_id: 458,
					label: 'Plastic',
					description: null,
					recipe_io: [{ item_name: 'plastic-bar', item_type: 'output', quality: 0, amount: 15 }]
				}
			]
		});
	});
	assert.equal(
		result.results[0]?.url,
		'https://www.factoriocodex.com/blueprints/458/recipe-details/22921'
	);
	assert.deepEqual(result.results[0]?.rates, [
		{ name: 'plastic-bar', direction: 'output', quality: 0, perSecond: 15 }
	]);
	assert.equal(result.untrusted, true);
	assert.match(result.note, /theoretical.*not measured/);
	await assert.rejects(searchFactoryBlueprints([], []), /Choose input/);
});

test('Codex retrieval preserves component settings and selects the current book version', async () => {
	const blueprint = {
		label: 'Configured',
		entities: [
			{
				name: 'inserter',
				position: { x: 0.5, y: 0.5 },
				filters: [{ index: 1, name: 'plastic-bar' }],
				pickup_position: { x: 0, y: -2 }
			}
		],
		wires: [[1, 1, 2, 1]]
	};
	const encoded = encode({ blueprint });
	const component = await sharedBlueprint(
		'https://factoriocodex.com/blueprints/458/recipe-details/22921',
		[],
		(url) => {
			if (url.endsWith('/recipe-details/22921'))
				return JSON.stringify({ label: 'Configured', description: 'Community design' });
			assert.equal(url, 'https://www.factoriocodex.com/api/v1/blueprints/458/details/22921/string');
			return `${encoded}\n`;
		}
	);
	assert.ok('blueprint' in component);
	assert.deepEqual(component.blueprint, { ...blueprint, tiles: [] });
	const book = encode({
		blueprint_book: { label: 'Current book', blueprints: [{ index: 7, blueprint }] }
	});
	const selected = await sharedBlueprint(
		'https://www.factoriocodex.com/blueprints/458',
		[7],
		(url) => {
			assert.equal(url, 'https://www.factoriocodex.com/api/v1/blueprints/458');
			return JSON.stringify({
				title: 'Book',
				current_version: 2,
				versions: [
					{ version_number: 1, blueprint_string: 'invalid retired version' },
					{ version_number: 2, blueprint_string: book }
				]
			});
		}
	);
	assert.ok('blueprint' in selected);
	assert.deepEqual(selected.blueprint, component.blueprint);
	for (const url of [
		'https://factoriocodex.com.evil.example/blueprints/458',
		'https://factoriocodex.com/blueprints/458/../private',
		'https://factoriocodex.com/blueprints/0'
	])
		await assert.rejects(
			sharedBlueprint(url, [], () => {
				throw new Error('Unexpected fetch');
			}),
			/Use a Factorio/
		);
});
