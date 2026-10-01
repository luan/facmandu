const CHAT_LINE =
	/^\s*(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\d+\.\d+) \[CHAT\] ([A-Za-z0-9_-]{3,30}):\s*@assistant(?:\s+|$)(.*)$/iu;
const RICH_TAG =
	/^\[(?:(?:item|fluid|recipe|technology|entity)=[a-z0-9_-]{1,100}|gps=-?\d{1,9}(?:\.\d{1,3})?,-?\d{1,9}(?:\.\d{1,3})?,[a-z0-9_-]{1,100})\]$/iu;
const RICH_TAGS = /\[[^\]\r\n]*\]/gu;
const WEB_HINT = ' See the web chat for the full reply.';
const REPLY_BYTES = 700;

export function parseGameChat(text: string): { player: string; prompt: string } | null {
	if (/[\r\n]/u.test(text)) return null;
	const match = CHAT_LINE.exec(text);
	if (!match) return null;
	const player = match[1];
	const prompt = match[2]?.trim();
	if (!player || !prompt || prompt.length > 6000) return null;
	if (/^(?:server|assistant|facmandu|rcon)$/iu.test(player)) return null;
	return { player, prompt };
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
