import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import {
	normalizeContext,
	type ToolResultMessage,
	type TranscriptContext
} from '@earendil-works/pi-ai';
import { factoryImageSchema, factoryViewRequestSchema } from '../src/lib/factory-images';
import { addFactoryImages } from '../src/lib/server/factory-image-context';
import { blueprintImageData, pngDimensions } from '../src/lib/server/factory-image-data';

const encode = (blueprint: unknown) =>
	`0${deflateSync(JSON.stringify({ blueprint })).toString('base64')}`;
const layout = {
	version: 562954953031680,
	entities: [
		{
			entity_number: 1,
			name: 'kr-advanced-chemical-plant',
			position: { x: 0, y: 0 },
			recipe: 'plastic-bar',
			quality: 'rare'
		}
	]
};
const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.writeUInt32BE(128, 16);
png.writeUInt32BE(96, 20);
const id = 'a'.repeat(64);
const message = (imageId = id, toolName = 'factory_view'): ToolResultMessage => ({
	role: 'toolResult',
	toolCallId: 'view',
	toolName,
	isError: false,
	timestamp: 0,
	content: [
		{
			type: 'text',
			text: JSON.stringify({
				kind: 'factory-result',
				result: { image: { id: imageId, width: 128, height: 96 } }
			})
		}
	]
});

test('blueprint rendering preserves mod names, recipes and native quality settings', () => {
	assert.deepEqual(blueprintImageData(encode(layout)), layout);
});
test('blueprint title changes reuse the same rendered layout', () => {
	assert.deepEqual(
		blueprintImageData(encode({ ...layout, label: 'Draft', description: 'First', icons: [] })),
		blueprintImageData(encode({ ...layout, label: 'Final' }))
	);
});
test('image input rejects decompression bombs, excessive entities and unbounded regions', () => {
	for (const invalid of [
		{ ...layout, entities: Array(1001).fill(layout.entities[0]) },
		{
			...layout,
			entities: [...layout.entities, { entity_number: 2, name: 'pipe', position: { x: 129, y: 0 } }]
		},
		{ ...layout, description: 'x'.repeat(1024 * 1024) }
	])
		assert.throws(() => blueprintImageData(encode(invalid)));
	assert.throws(() => blueprintImageData('not-a-blueprint'));
	assert.equal(
		factoryViewRequestSchema.safeParse({
			force: 'player',
			surface: 'nauvis',
			position: { x: 0, y: 0 },
			width: 97
		}).success,
		false
	);
	assert.equal(
		factoryImageSchema.safeParse({ id: '../../secret', width: 1, height: 1 }).success,
		false
	);
});
test('model vision receives the exact PNG referenced by the harness without mutating history', () => {
	const context: TranscriptContext = normalizeContext({ messages: [message()] });
	const seen: string[] = [];
	const updated = addFactoryImages(context, (imageId) => {
		seen.push(imageId);
		return png;
	});
	assert.deepEqual(seen, [id]);
	assert.equal(context.messages[0]?.role, 'toolResult');
	const original = context.messages[0];
	const result = updated.messages[0];
	if (original?.role !== 'toolResult' || result?.role !== 'toolResult')
		throw new Error('Expected tool results');
	assert.equal(original.content.length, 1);
	assert.deepEqual(result.content[1], {
		type: 'image',
		data: png.toString('base64'),
		mimeType: 'image/png'
	});
});
test('vision bounds image history and rejects forged or unrelated tool references', () => {
	let reads = 0;
	addFactoryImages(
		normalizeContext({
			messages: [
				message(),
				message(),
				message(),
				message(id, 'factory_lookup'),
				message('../secret')
			]
		}),
		() => {
			reads++;
			return png;
		}
	);
	assert.equal(reads, 2);
	assert.throws(() => pngDimensions(Buffer.from('not PNG')));
	const excessive = Buffer.from(png);
	excessive.writeUInt32BE(1537, 16);
	assert.throws(() => pngDimensions(excessive));
});
test('a missing image tells the model it has not seen the snapshot', () => {
	const updated = addFactoryImages(normalizeContext({ messages: [message()] }), () => {
		throw new Error('File missing');
	});
	const result = updated.messages[0];
	if (result?.role !== 'toolResult') throw new Error('Expected tool result');
	assert.deepEqual(result.content[1], {
		type: 'text',
		text: 'The referenced factory image is unavailable. Do not claim to have viewed it; capture another factory_view.'
	});
});
test('text-only models are told that the harness image is not visible to them', () => {
	const updated = addFactoryImages(
		normalizeContext({ messages: [message()] }),
		() => {
			throw new Error('Image bytes should not be loaded');
		},
		false
	);
	const result = updated.messages[0];
	if (result?.role !== 'toolResult') throw new Error('Expected tool result');
	assert.equal(
		result.content.some((part) => part.type === 'image'),
		false
	);
	assert.ok(
		result.content.some(
			(part) => part.type === 'text' && part.text.includes('you have not viewed it')
		)
	);
});

test('foundation-only previews preserve tiles and reject empty blueprints', () => {
	const tiles = [{ name: 'space-platform-foundation', position: { x: 1, y: 2 } }];
	assert.deepEqual(blueprintImageData(encode({ version: layout.version, tiles })), {
		version: layout.version,
		entities: [],
		tiles
	});
	assert.throws(() =>
		blueprintImageData(encode({ version: layout.version, entities: [], tiles: [] }))
	);
});
