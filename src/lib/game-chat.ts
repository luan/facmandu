import { z } from 'zod';

const CHAT_LINE =
	/^\s*(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\d+\.\d+) \[CHAT\] ([A-Za-z0-9_-]{3,30}):\s*(.*)$/iu;
const RICH_TAG =
	/^\[(?:(?:item|fluid|recipe|technology|entity)=[a-z0-9_-]{1,100}|gps=-?\d{1,9}(?:\.\d{1,3})?,-?\d{1,9}(?:\.\d{1,3})?,[a-z0-9_-]{1,100})\]$/iu;
const RICH_TAGS = /\[[^\]\r\n]*\]/gu;
const WEB_HINT = ' See the web chat for the full reply.';
const REPLY_BYTES = 700;

export function parseGameChat(
	text: string,
	ambient = false
): { player: string; prompt: string; ambient?: true } | null {
	if (/[\r\n]/u.test(text)) return null;
	const match = CHAT_LINE.exec(text);
	if (!match) return null;
	const player = match[1];
	const content = match[2]?.trim() ?? '';
	const mention = /^@(?:(?:assistant|toby)(?:\s+|$))?\s*(.*)$/iu.exec(content);
	if (!mention && !ambient) return null;
	const prompt = (mention ? mention[1] : content)?.trim();
	if (!player || !prompt || prompt.length > 6000) return null;
	if (/^(?:server|assistant|facmandu|rcon)$/iu.test(player)) return null;
	return { player, prompt, ...(!mention ? { ambient: true as const } : {}) };
}

function plainReply(text: string): string {
	const tags: string[] = [];
	const plain = text
		.replace(/\0/gu, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
		.replace(RICH_TAGS, (tag) => {
			if (!RICH_TAG.test(tag)) return '';
			return `\0${tags.push(tag) - 1}\0`;
		})
		.replace(/<[^>]*>/gu, '')
		.replace(/https?:\/\/\S+/giu, '')
		.replace(/(?:^|\n)\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/gu, ' ')
		.replace(/[`*_~]/gu, '')
		.replace(/\s+/gu, ' ')
		.trim();
	return plain.replace(/\0(\d+)\0/gu, (_, index: string) => tags[Number(index)] ?? '');
}

function replyChunks(text: string, budgets: readonly number[]): string[] {
	const pieces =
		text.match(
			/\[(?:(?:item|fluid|recipe|technology|entity)=[a-z0-9_-]{1,100}|gps=-?\d{1,9}(?:\.\d{1,3})?,-?\d{1,9}(?:\.\d{1,3})?,[a-z0-9_-]{1,100})\]|\s+|[^\s[]+|\[/giu
		) ?? [];
	const chunks: string[] = [];
	let current = '';
	let index = 0;
	const flush = () => {
		if (current.trim()) chunks.push(current.trim());
		current = '';
		index++;
	};
	for (const piece of pieces) {
		for (const char of RICH_TAG.test(piece) ? [piece] : [...piece]) {
			const budget = budgets[Math.min(index, budgets.length - 1)] ?? REPLY_BYTES;
			if (Buffer.byteLength(current + char) > budget) flush();
			if (index >= budgets.length) return chunks;
			current += char;
		}
	}
	if (current.trim()) chunks.push(current.trim());
	return chunks;
}

export function gameReply(text: string): string[] {
	const reply = plainReply(text);
	if (!reply) return [];
	const chunks = replyChunks(reply, [REPLY_BYTES, REPLY_BYTES, REPLY_BYTES, REPLY_BYTES]);
	if (chunks.length <= 3) return chunks;
	const truncated = replyChunks(reply, [
		REPLY_BYTES,
		REPLY_BYTES,
		REPLY_BYTES - Buffer.byteLength(WEB_HINT)
	]);
	return [...truncated.slice(0, 2), `${truncated[2] ?? ''}${WEB_HINT}`.trim()];
}

const uiMessageSchema = z.object({
	player: z.string().regex(/^[A-Za-z0-9_-]{3,30}$/u),
	operation: z.enum(['refresh', 'select', 'new', 'send', 'stop']),
	prompt: z.string().min(1).max(6000).optional(),
	chat: z.string().min(1).max(100).optional(),
	sequence: z.number().int().nonnegative()
});
export function parseGameUi(text: string) {
	const match =
		/^\s*\d+\.\d+ Script @__facmandu-assistant__\/control\.lua:\d+: \[FACMANDU_UI\] (.+)$/u.exec(
			text
		);
	if (!match) return null;
	try {
		const result = uiMessageSchema.safeParse(JSON.parse(match[1] ?? ''));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}
// Native GUI strings are capped in UTF-8 bytes, not JavaScript code units.
export function gameText(value: string, bytes: number): string {
	let result = '';
	let size = 0;
	for (const char of value) {
		size += Buffer.byteLength(char);
		if (size > bytes) break;
		result += char;
	}
	return result;
}
