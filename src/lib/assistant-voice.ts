import { z } from 'zod';

export type VoiceState = {
	active: boolean;
	connecting: boolean;
	muted: boolean;
	status: string;
	userCaption: string;
	assistantCaption: string;
	error: string;
};
export const idleVoice: VoiceState = {
	active: false,
	connecting: false,
	muted: false,
	status: '',
	userCaption: '',
	assistantCaption: '',
	error: ''
};
const eventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('delegation.created'),
		item: z.object({
			id: z.string().min(1).max(256),
			type: z.literal('delegation'),
			target: z.literal('client'),
			content: z.array(z.object({ type: z.literal('input_text'), text: z.string() }))
		})
	}),
	z.object({
		type: z.literal('turn.done'),
		turn: z.object({ role: z.enum(['user', 'assistant']), transcript: z.string().max(32_000) })
	}),
	z.object({
		type: z.enum(['input_transcript.added', 'output_transcript.added']),
		item: z.object({ text: z.string().max(32_000) })
	}),
	z.object({ type: z.literal('error') })
]);

// Keep context messages within pi-voice's 500-byte data-channel limit, including Unicode.
function contextChunks(text: string): string[] {
	const encoder = new TextEncoder();
	const chunks: string[] = [];
	let chunk = '';
	let bytes = 0;
	for (const character of text) {
		const length = encoder.encode(character).byteLength;
		if (bytes + length > 500) {
			chunks.push(chunk);
			chunk = '';
			bytes = 0;
		}
		chunk += character;
		bytes += length;
	}
	if (chunk) chunks.push(chunk);
	return chunks;
}

export class AssistantVoice {
	private state = { ...idleVoice };
	private peer?: RTCPeerConnection;
	private channel?: RTCDataChannel;
	private stream?: MediaStream;
	private audio?: HTMLAudioElement;
	private connection?: AbortController;
	private generation = 0;
	private pending = Promise.resolve();
	private queued = 0;
	private seen = new Set<string>();
	private userFinal = true;
	private assistantFinal = true;
	constructor(
		private readonly callbacks: {
			change: (state: VoiceState) => void;
			request: (prompt: string) => Promise<string>;
		}
	) {}
	private update(patch: Partial<VoiceState>) {
		this.state = { ...this.state, ...patch };
		this.callbacks.change(this.state);
	}
	stop() {
		this.generation++;
		this.connection?.abort();
		this.connection = undefined;
		this.stream?.getTracks().forEach((track) => {
			track.stop();
		});
		this.stream = undefined;
		if (this.audio) {
			this.audio.pause();
			this.audio.srcObject = null;
			this.audio = undefined;
		}
		this.channel?.close();
		this.channel = undefined;
		this.peer?.close();
		this.peer = undefined;
		this.pending = Promise.resolve();
		this.queued = 0;
		this.seen.clear();
		this.userFinal = true;
		this.assistantFinal = true;
		this.update({ ...idleVoice });
	}
	private fail(message: string) {
		this.stop();
		this.update({ error: message });
	}
	mute() {
		if (!this.state.active) return;
		const muted = !this.state.muted;
		this.stream?.getAudioTracks().forEach((track) => {
			track.enabled = !muted;
		});
		this.update({ muted, status: muted ? 'Microphone muted' : 'Listening' });
	}
	async start(target: { chat: string; listId?: string; serverId?: string }) {
		if (this.state.active || this.state.connecting) return;
		this.stop();
		const generation = this.generation;
		const current = () => generation === this.generation;
		this.update({ connecting: true, status: 'Connecting voice…' });
		try {
			if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined')
				throw new Error('Voice needs a browser with microphone and WebRTC support over HTTPS.');
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
				video: false
			});
			if (!current()) {
				stream.getTracks().forEach((track) => {
					track.stop();
				});
				return;
			}
			this.stream = stream;
			const peer = new RTCPeerConnection();
			this.peer = peer;
			const audio = new Audio();
			audio.autoplay = true;
			this.audio = audio;
			peer.ontrack = (event) => {
				if (!current()) return;
				audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
				void audio.play().catch(() => {
					if (current())
						this.fail('Browser blocked voice playback. Allow audio for this site and retry.');
				});
			};
			peer.onconnectionstatechange = () => {
				if (current() && ['failed', 'disconnected', 'closed'].includes(peer.connectionState))
					this.fail('Voice disconnected. Start voice again to reconnect.');
			};
			for (const track of stream.getTracks()) {
				track.onended = () => {
					if (current()) this.fail('Microphone disconnected. Start voice again to retry.');
				};
				peer.addTrack(track, stream);
			}
			const channel = peer.createDataChannel('oai-events');
			this.channel = channel;
			channel.onopen = () => {
				if (!current()) return;
				signal.removeEventListener('abort', timedOut);
				this.connection = undefined;
				this.update({ active: true, connecting: false, status: 'Listening' });
			};
			channel.onclose = () => {
				if (current()) this.fail('Voice disconnected. Start voice again to reconnect.');
			};
			channel.onmessage = (event) => {
				if (current() && typeof event.data === 'string') this.receive(event.data, generation);
			};
			const controller = new AbortController();
			this.connection = controller;
			const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
			const timedOut = () => {
				if (current()) this.fail('Voice connection timed out. Retry.');
			};
			signal.addEventListener('abort', timedOut, { once: true });
			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);
			if (!current()) return;
			const form = new URLSearchParams({ chat: target.chat, sdp: offer.sdp ?? '' });
			if (target.listId) form.set('listId', target.listId);
			if (target.serverId) form.set('serverId', target.serverId);
			const response = await fetch('/api/assistant/voice', {
				method: 'POST',
				headers: { Accept: 'application/json' },
				body: form,
				signal
			});
			if (!current()) return;
			if (!response.ok) {
				const value: unknown = await response.json();
				throw new Error(
					z.object({ message: z.string() }).safeParse(value).data?.message ??
						'Could not connect voice. Retry.'
				);
			}
			await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
		} catch (cause) {
			if (current())
				this.fail(
					cause instanceof Error && cause.name === 'NotAllowedError'
						? 'Allow microphone access to start voice.'
						: cause instanceof Error
							? cause.message
							: 'Could not start voice'
				);
		}
	}
	private context(id: string, text: string) {
		for (const chunk of contextChunks(text)) {
			if (this.channel?.readyState !== 'open') return;
			try {
				this.channel.send(
					JSON.stringify({
						type: 'delegation.context.append',
						delegation_item_id: id,
						channel: 'speakable',
						content: [{ type: 'input_text', text: chunk }]
					})
				);
			} catch {
				this.fail('Voice disconnected while replying. The result is still in the chat.');
				return;
			}
		}
	}
	private receive(raw: string, generation: number) {
		if (raw.length > 65_536) return;
		let data: unknown;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}
		const parsed = eventSchema.safeParse(data);
		if (!parsed.success) return;
		const event = parsed.data;
		if (event.type === 'error') {
			this.fail('Codex voice could not continue. Start voice again to retry.');
			return;
		}
		if (event.type === 'turn.done') {
			if (event.turn.role === 'user') this.userFinal = true;
			else this.assistantFinal = true;
			this.update(
				event.turn.role === 'user'
					? { userCaption: event.turn.transcript, status: 'Thinking…' }
					: {
							assistantCaption: event.turn.transcript,
							status: this.state.muted ? 'Microphone muted' : 'Listening'
						}
			);
			return;
		}
		if (event.type === 'input_transcript.added') {
			this.update({
				userCaption: ((this.userFinal ? '' : this.state.userCaption) + event.item.text).slice(
					-32_000
				)
			});
			this.userFinal = false;
			return;
		}
		if (event.type === 'output_transcript.added') {
			this.update({
				assistantCaption: (
					(this.assistantFinal ? '' : this.state.assistantCaption) + event.item.text
				).slice(-32_000),
				status: 'Speaking'
			});
			this.assistantFinal = false;
			return;
		}
		if (event.type !== 'delegation.created' || !this.state.active) return;
		const id = event.item.id;
		if (this.seen.has(id)) return;
		if (this.seen.size >= 1000) {
			this.fail('Start a fresh voice call to continue.');
			return;
		}
		this.seen.add(id);
		const message = event.item.content
			.map((item) => item.text)
			.join('\n')
			.trim();
		if (!message || message.length > 6000 || this.queued >= 8) {
			this.context(id, 'This request could not be accepted. Ask one shorter question at a time.');
			return;
		}
		this.queued++;
		this.pending = this.pending.then(async () => {
			if (generation !== this.generation) return;
			this.update({ status: 'Thinking…' });
			try {
				const answer = await this.callbacks.request(message);
				if (generation === this.generation)
					this.context(
						id,
						answer || 'The assistant returned no answer. Ask to retry; do not claim success.'
					);
			} catch (cause) {
				if (generation === this.generation)
					this.context(
						id,
						cause instanceof Error ? cause.message : 'The request failed. Do not claim success.'
					);
			} finally {
				if (generation === this.generation) this.queued--;
			}
		});
	}
}
