import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventStream } from '../src/lib/server/event-stream';

test('event streams deliver complete initial snapshots and release subscriptions on cancel', async () => {
	const abort = new AbortController();
	let released = 0;
	const response = eventStream(abort.signal, (send) => {
		for (let index = 0; index < 100; index++) send(`data: ${index}\n\n`);
		return () => {
			released++;
		};
	});
	const reader = response.body?.getReader();
	assert.ok(reader);
	for (let index = -1; index < 100; index++) {
		const part: ReadableStreamReadResult<Uint8Array> = await reader.read();
		assert.equal(part.done, false);
		if (index >= 0) assert.equal(new TextDecoder().decode(part.value), `data: ${index}\n\n`);
	}
	await reader.cancel();
	abort.abort();
	assert.equal(released, 1);
});

test('slow readers are disconnected with a bounded queue and no subscription leak', async () => {
	let released = 0;
	const response = eventStream(new AbortController().signal, (send) => {
		for (let index = 0; index < 100; index++) send('x'.repeat(64 * 1024));
		return () => {
			released++;
		};
	});
	assert.equal(released, 1);
	const size = (await response.arrayBuffer()).byteLength;
	assert.ok(size <= 18 * 64 * 1024);
});
