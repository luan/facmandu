import type { PrototypeRef } from './factory-results';

export type RichTextPart =
	| { kind: 'text'; text: string; color?: string; bold: boolean }
	| { kind: 'icon'; prototype: PrototypeRef; caption: string; color?: string; bold: boolean };

type Format = { tag: 'color' | 'font'; color?: string; bold: boolean };
const iconKinds = ['item', 'fluid', 'entity', 'technology', 'recipe'] as const;
const namedColors: Record<string, string> = {
	red: '#f87171',
	green: '#4ade80',
	blue: '#60a5fa',
	yellow: '#facc15',
	orange: '#fb923c',
	white: '#ffffff',
	black: '#000000',
	gray: '#9ca3af',
	grey: '#9ca3af',
	cyan: '#22d3ee',
	purple: '#c084fc',
	pink: '#f472b6'
};

function safeColor(raw: string): string | undefined {
	const color = raw.trim().toLowerCase();
	if (Object.hasOwn(namedColors, color)) return namedColors[color];
	if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/u.test(color)) return color;
	if (!/^(?:\d+(?:\.\d+)?\s*,\s*){2,3}\d+(?:\.\d+)?$/u.test(color)) return undefined;
	const channels = color.split(',').map((part) => Number(part.trim()));
	if (channels.length < 3 || channels.length > 4 || channels.some((part) => part < 0 || part > 255))
		return undefined;
	const unit = channels.slice(0, 3).every((part) => part <= 1);
	const rgb = channels.slice(0, 3).map((part) => Math.round(unit ? part * 255 : part));
	const alpha = channels[3] === undefined ? 1 : channels[3] > 1 ? channels[3] / 255 : channels[3];
	return `rgb(${rgb.join(' ')} / ${alpha})`;
}

function prototypeTag(body: string): PrototypeRef | null {
	const match = /^(item|fluid|entity|technology|recipe|img)=(.+)$/u.exec(body);
	if (!match?.[1] || !match[2]) return null;
	const value = match[2];
	const ref = match[1] === 'img' ? /^(item|fluid|entity|technology|recipe)\/(.+)$/u.exec(value) : null;
	const kind = (ref?.[1] ?? match[1]) as PrototypeRef['kind'];
	const name = ref?.[2] ?? value;
	if (!iconKinds.some((candidate) => candidate === kind) || !/^[a-zA-Z0-9_.-]{1,200}$/u.test(name))
		return null;
	return { kind, name };
}

export function parseFactorioRichText(source: string): RichTextPart[] {
	const parts: RichTextPart[] = [];
	const stack: Format[] = [];
	let color: string | undefined;
	let bold = false;
	let position = 0;
	const append = (text: string) => {
		if (!text) return;
		const previous = parts.at(-1);
		if (previous?.kind === 'text' && previous.color === color && previous.bold === bold)
			previous.text += text;
		else parts.push({ kind: 'text', text, color, bold });
	};
	for (const match of source.matchAll(/\[([^\[\]\n]{1,256})\]/gu)) {
		const index = match.index ?? position;
		append(source.slice(position, index));
		position = index + match[0].length;
		const body = match[1];
		if (body === undefined) continue;
		const closing = /^\/(color|font)$/u.exec(body);
		if (closing) {
			const frame = stack.findLast((entry) => entry.tag === closing[1]);
			if (frame) {
				color = frame.color;
				bold = frame.bold;
				stack.length = stack.lastIndexOf(frame);
			}
			continue;
		}
		const format = /^(color|font)=(.*)$/u.exec(body);
		if (format) {
			stack.push({ tag: format[1] as Format['tag'], color, bold });
			if (format[1] === 'color') color = safeColor(format[2] ?? '') ?? color;
			else if (/^default-(?:semi)?bold(?:-\d{1,2})?$/u.test(format[2] ?? '')) bold = true;
			continue;
		}
		const prototype = prototypeTag(body);
		if (prototype) {
			parts.push({
				kind: 'icon',
				prototype,
				caption: prototype.name.replaceAll(/[-_]/gu, ' '),
				color,
				bold
			});
			continue;
		}
		// Unknown Factorio tags lose their markup while their surrounding text remains.
		if (!/^\/?[a-z][a-z0-9_-]*(?:=.*)?$/iu.test(body)) append(match[0]);
	}
	append(source.slice(position));
	return parts;
}
