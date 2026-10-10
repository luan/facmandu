import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { dropboxContentHash, validateCloudSave } from '../src/lib/dropbox-saves';

test('Dropbox content hashes cover empty files and multiple blocks', () => {
	for (const size of [0, 5, 4 * 1024 * 1024, 4 * 1024 * 1024 + 7]) {
		const bytes = Buffer.alloc(size, 42);
		const blocks = [];
		for (let offset = 0; offset < size; offset += 4 * 1024 * 1024)
			blocks.push(
				createHash('sha256')
					.update(bytes.subarray(offset, offset + 4 * 1024 * 1024))
					.digest()
			);
		assert.equal(
			dropboxContentHash(bytes),
			createHash('sha256').update(Buffer.concat(blocks)).digest('hex')
		);
	}
});
test('cloud restores accept Factorio worlds and reject truncated or unrelated archives', () => {
	const world = zipSync({ 'world/level.dat': strToU8('world bytes') });
	assert.doesNotThrow(() => validateCloudSave(world));
	const splitWorld = {
		'world/level-init.dat': strToU8('initial world'),
		'world/level.dat0': strToU8('world chunk'),
		'world/level.datmetadata': strToU8('chunk metadata')
	};
	assert.doesNotThrow(() => validateCloudSave(zipSync(splitWorld)));
	assert.throws(
		() => validateCloudSave(zipSync({ 'world/level-init.dat': strToU8('initial') })),
		/Factorio/
	);
	assert.throws(
		() =>
			validateCloudSave(zipSync({ ...splitWorld, 'world/level.datmetadata': new Uint8Array() })),
		/Factorio/
	);
	assert.throws(() => validateCloudSave(world.subarray(0, world.length - 22)));
	assert.throws(() => validateCloudSave(zipSync({ 'image.png': strToU8('image') })), /Factorio/);
	assert.throws(() => validateCloudSave(zipSync({ '../level.dat': strToU8('world') })), /Factorio/);
});
