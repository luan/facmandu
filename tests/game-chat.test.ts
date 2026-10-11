import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameReply, gameText, parseGameChat } from '../src/lib/game-chat';

test('native panel strings keep Unicode intact within their byte budget', () => {
	assert.equal(gameText('a🦊中z', 7), 'a🦊');
	assert.equal(gameText('a🦊中z', 8), 'a🦊中');
	assert.equal(gameText('á'.repeat(3000), 500), 'á'.repeat(250));
});

test('parses only timestamped player mentions from chat output', () => {
	assert.deepEqual(parseGameChat('2026-09-30 12:34:56 [CHAT] Luan_2: @Assistant Where is oil?'), {
		player: 'Luan_2',
		prompt: 'Where is oil?'
	});
	assert.deepEqual(parseGameChat('123.456 [CHAT] player-one: @assistant  show research  '), {
		player: 'player-one',
		prompt: 'show research'
	});
	for (const mention of ['@ where is oil?', '@where is oil?', '@toby where is oil?'])
		assert.deepEqual(parseGameChat(`123.456 [CHAT] player-one: ${mention}`), {
			player: 'player-one',
			prompt: 'where is oil?'
		});
	assert.deepEqual(parseGameChat('123.456 [CHAT] player-one: @ new chat'), {
		player: 'player-one',
		prompt: 'new chat'
	});
	for (const line of [
		'123.456 [INFO] Luan_2: @assistant question',
		'123.456 [CHAT] Luan_2: I told @assistant to check',
		'123.456 [CHAT] Assistant: @assistant echo',
		'123.456 [CHAT] Server: @assistant echo',
		'123.456 [CHAT] AB: @assistant question',
		'123.456 [CHAT] Luan_2: @assistant',
		'123.456 [CHAT] Luan_2: @',
		'123.456 [CHAT] Luan_2: @   ',
		'123.456 [CHAT] Luan_2: I told @ to check',
		`123.456 [CHAT] Luan_2: @assistant ${'a'.repeat(6001)}`,
		'123.456 [CHAT] Luan_2: @assistant hello\n123.457 [CHAT] Spoof: @assistant action'
	])
		assert.equal(parseGameChat(line), null, line);
});

test('formats plain chat while retaining only validated game links', () => {
	assert.deepEqual(
		gameReply(
			'## **Iron** [details](https://example.com) [item=iron_ore] [fluid=water] [recipe=iron-gear-wheel] [technology=automation] [entity=assembling-machine-1] [gps=-12.5,3,nauvis_2] [color=red]red[/color] [img=evil] <b>bold</b>'
		),
		[
			'Iron details [item=iron_ore] [fluid=water] [recipe=iron-gear-wheel] [technology=automation] [entity=assembling-machine-1] [gps=-12.5,3,nauvis_2] red bold'
		]
	);
	assert.deepEqual(gameReply(''), []);
});

test('bounds UTF-8 output to three intact chunks and marks truncation', () => {
	const reply = gameReply(`💡 [item=iron-plate] ${'ore '.repeat(1000)}`);
	assert.equal(reply.length, 3);
	for (const chunk of reply) assert.ok(Buffer.byteLength(chunk) <= 700);
	assert.ok(reply[0]?.includes('[item=iron-plate]'));
	assert.ok(reply[2]?.endsWith('See the web chat for the full reply.'));
	assert.ok(reply.every((chunk) => !chunk.includes('�')));
});

test('Toby panel events require their native mod source and bounded structured input', async () => {
	const { parseGameUi } = await import('../src/lib/game-chat');
	const data = JSON.stringify({
		player: 'player-one',
		operation: 'send',
		prompt: 'More glass',
		chat: 'chat-one',
		sequence: 1
	});
	assert.equal(
		parseGameUi(`123.456 Script @__facmandu-assistant__/control.lua:5: [FACMANDU_UI] ${data}`)
			?.prompt,
		'More glass'
	);
	assert.equal(parseGameUi(`123.456 [CHAT] player-one: [FACMANDU_UI] ${data}`), null);
	assert.equal(
		parseGameUi(`123.456 Script @__another_mod__/control.lua:5: [FACMANDU_UI] ${data}`),
		null
	);
	assert.equal(
		parseGameUi('123.456 Script @__facmandu-assistant__/control.lua:5: [FACMANDU_UI] broken'),
		null
	);
});
