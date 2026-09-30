// @ts-expect-error Bun supplies test types at runtime; it is not a browser dependency.
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { AssistantVoice, idleVoice, type VoiceState } from '../src/lib/assistant-voice';

const restore: (() => void)[] = [];
const voices: AssistantVoice[] = [];
function replace(name: string, value: unknown) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	restore.push(() => {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	});
}
afterEach(() => {
	for (const voice of voices.splice(0)) voice.stop();
	for (const undo of restore.splice(0).reverse()) undo();
});
function browser(request = mock(() => Promise.resolve('Done'))) {
	let state: VoiceState = { ...idleVoice };
	const track = { enabled: true, stop: mock(() => {}) };
	const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
	const microphone = mock(() => Promise.resolve(stream));
	const channel = {
		readyState: 'open',
		onopen: () => {},
		onclose: () => {},
		onmessage: (_event: { data: string }) => {},
		send: mock((_text: string) => {}),
		close: mock(() => {})
	};
	const connection = {
		connectionState: 'connected',
		onconnectionstatechange: () => {},
		ontrack: (_event: { streams: unknown[] }) => {},
		addTrack: mock(() => {}),
		createDataChannel: () => channel,
		createOffer: () => Promise.resolve({ type: 'offer', sdp: 'v=0\r\nfixture-offer' }),
		setLocalDescription: () => Promise.resolve(),
		setRemoteDescription: mock(() => {
			channel.onopen();
			return Promise.resolve();
		}),
		close: mock(() => {})
	};
	const audio = {
		autoplay: false,
		srcObject: null,
		play: () => Promise.resolve(),
		pause: mock(() => {})
	};
	const fetch = mock((_url: string, _init: RequestInit) =>
		Promise.resolve(new Response('v=0\r\nfixture-answer'))
	);
	replace('navigator', { mediaDevices: { getUserMedia: microphone } });
	replace(
		'RTCPeerConnection',
		class {
			constructor() {
				// biome-ignore lint/correctness/noConstructorReturn: Supply an observable browser peer stub.
				return connection;
			}
		}
	);
	replace(
		'Audio',
		class {
			constructor() {
				// biome-ignore lint/correctness/noConstructorReturn: Supply an observable browser audio stub.
				return audio;
			}
		}
	);
	replace('fetch', fetch);
	const voice = new AssistantVoice({
		change: (value) => {
			state = value;
		},
		request
	});
	voices.push(voice);
	return {
		voice,
		state: () => state,
		track,
		stream,
		microphone,
		channel,
		connection,
		fetch,
		request
	};
}
const delegation = (id: string, text: string) =>
	JSON.stringify({
		type: 'delegation.created',
		item: { id, type: 'delegation', target: 'client', content: [{ type: 'input_text', text }] }
	});
async function settle(predicate: () => boolean) {
	// Drain promise callbacks without sleeping or depending on wall-clock timing.
	for (let step = 0; step < 30 && !predicate(); step++) await Promise.resolve();
	expect(predicate()).toBe(true);
}

test('spoken requests use the selected chat, execute once, and return Unicode-safe speech context', async () => {
	const answer = 'Research ⚗️ confirmed. '.repeat(70);
	const app = browser(mock(() => Promise.resolve(answer)));
	await app.voice.start({ chat: 'chat-one', listId: 'list-one' });
	expect(app.state().active).toBe(true);
	const form = app.fetch.mock.calls[0]?.[1].body;
	expect(form).toBeInstanceOf(URLSearchParams);
	expect(String(form)).toContain('chat=chat-one');
	expect(String(form)).toContain('listId=list-one');
	expect(String(form)).not.toContain('Bearer');
	app.channel.onmessage({ data: delegation('request-one', 'Start electronics research') });
	app.channel.onmessage({ data: delegation('request-one', 'Start electronics research') });
	await settle(() => app.channel.send.mock.calls.length > 0);
	expect(app.request.mock.calls).toEqual([['Start electronics research']]);
	const replies: { type: string; delegation_item_id: string; content: { text: string }[] }[] =
		app.channel.send.mock.calls.map(
			([raw]: [string]) =>
				JSON.parse(raw) as { type: string; delegation_item_id: string; content: { text: string }[] }
		);
	expect(replies.map((reply) => reply.content[0]?.text).join('')).toBe(answer);
	for (const reply of replies) {
		expect(reply.type).toBe('delegation.context.append');
		expect(reply.delegation_item_id).toBe('request-one');
		expect(new TextEncoder().encode(reply.content[0]?.text).length).toBeLessThanOrEqual(500);
	}
	app.voice.mute();
	expect(app.track.enabled).toBe(false);
	app.voice.mute();
	expect(app.track.enabled).toBe(true);
	app.voice.stop();
	expect(app.track.stop).toHaveBeenCalledTimes(1);
	expect(app.connection.close).toHaveBeenCalledTimes(1);
	expect(app.state()).toEqual(idleVoice);
});

test('ending while microphone permission is pending stops late tracks without opening a call', async () => {
	const app = browser();
	const permission = Promise.withResolvers<typeof app.stream>();
	app.microphone.mockImplementation(() => permission.promise);
	const starting = app.voice.start({ chat: 'chat', serverId: 'server' });
	app.voice.stop();
	permission.resolve(app.stream);
	await starting;
	expect(app.fetch).not.toHaveBeenCalled();
	expect(app.track.stop).toHaveBeenCalledTimes(1);
	expect(app.state().active).toBe(false);
});

test('queued spoken actions are serialized and an ended call cannot execute queued actions', async () => {
	const answer = Promise.withResolvers<string>();
	const app = browser(mock(() => answer.promise));
	await app.voice.start({ chat: 'chat', serverId: 'server' });
	app.channel.onmessage({ data: delegation('one', 'First action') });
	app.channel.onmessage({ data: delegation('two', 'Second action') });
	await settle(() => app.request.mock.calls.length === 1);
	app.voice.stop();
	answer.resolve('Applied first action');
	await settle(() => true);
	for (let step = 0; step < 10; step++) await Promise.resolve();
	expect(app.request.mock.calls).toEqual([['First action']]);
	expect(app.channel.send).not.toHaveBeenCalled();
});

test('the negotiation deadline does not end an established call', async () => {
	const deadline = new AbortController();
	const timeout = spyOn(AbortSignal, 'timeout').mockImplementation(() => deadline.signal);
	restore.push(() => timeout.mockRestore());
	const app = browser();
	await app.voice.start({ chat: 'chat', serverId: 'server' });
	deadline.abort();
	expect(app.state().active).toBe(true);
	expect(app.track.stop).not.toHaveBeenCalled();
});

test('failed setup releases microphone and peer and shows a retryable error', async () => {
	const app = browser();
	app.fetch.mockImplementation(() =>
		Promise.resolve(Response.json({ message: 'Reconnect Codex' }, { status: 502 }))
	);
	await app.voice.start({ chat: 'chat', serverId: 'server' });
	expect(app.state().error).toBe('Reconnect Codex');
	expect(app.state().connecting).toBe(false);
	expect(app.track.stop).toHaveBeenCalledTimes(1);
	expect(app.connection.close).toHaveBeenCalledTimes(1);
});

test('live captions replace previous completed speech instead of accumulating it', async () => {
	const app = browser();
	await app.voice.start({ chat: 'chat', serverId: 'server' });
	app.channel.onmessage({
		data: JSON.stringify({
			type: 'turn.done',
			turn: { role: 'assistant', transcript: 'Old answer' }
		})
	});
	app.channel.onmessage({
		data: JSON.stringify({ type: 'output_transcript.added', item: { text: 'New ' } })
	});
	app.channel.onmessage({
		data: JSON.stringify({ type: 'output_transcript.added', item: { text: 'answer' } })
	});
	expect(app.state().assistantCaption).toBe('New answer');
	expect(app.state().status).toBe('Speaking');
});
