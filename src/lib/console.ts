export const MAX_CONSOLE_LINES = 2000;
const MAX_CONSOLE_CHARS = 256 * 1024;
export const consoleText = (text: string) =>
	text.length > 4096 ? `${text.slice(0, 4096)} … [truncated]` : text;

// Bound both row count and text volume; long mod output must not make replay or filtering expensive.
export function boundedConsoleLines<T extends { text: string }>(lines: T[]): T[] {
	let start = lines.length;
	let characters = 0;
	while (start > 0 && lines.length - start < MAX_CONSOLE_LINES) {
		const line = lines[start - 1];
		if (!line) break;
		const size = line.text.length;
		if (characters + size > MAX_CONSOLE_CHARS) break;
		characters += size;
		start--;
	}
	return lines.slice(start);
}

// Bound commands before sending them to Factorio.
export const RCON_COMMAND_BYTES = 1000;

export const consoleCommands = [
	{ value: '/help', description: 'List commands or describe a command' },
	{ value: '/players', description: 'List players' },
	{ value: '/players online', description: 'List connected players' },
	{ value: '/players count', description: 'Count players' },
	{ value: '/version', description: 'Show Factorio version' },
	{ value: '/time', description: 'Show map age' },
	{ value: '/seed', description: 'Show map seed' },
	{ value: '/evolution', description: 'Show evolution factors' },
	{ value: '/admins', description: 'List administrators' },
	{ value: '/bans', description: 'List banned players' },
	{ value: '/ban ', description: 'Ban a player: name and reason' },
	{ value: '/unban ', description: 'Unban a player' },
	{ value: '/kick ', description: 'Kick a player: name and reason' },
	{ value: '/promote ', description: 'Make a player an administrator' },
	{ value: '/demote ', description: 'Remove administrator status' },
	{ value: '/mute ', description: 'Mute a player' },
	{ value: '/unmute ', description: 'Unmute a player' },
	{ value: '/server-save', description: 'Save the current world' },
	{ value: '/shout ', description: 'Send a message to everyone' },
	{ value: '/whitelist get', description: 'Show the whitelist' },
	{ value: '/whitelist add ', description: 'Add a player to the whitelist' },
	{ value: '/whitelist remove ', description: 'Remove a player from the whitelist' },
	{ value: '/config get ', description: 'Read a server setting' },
	{ value: '/config set ', description: 'Change a server setting' },
	{ value: '/permissions ', description: 'Manage permission groups' },
	{ value: '/silent-command ', description: 'Run Lua without echoing it to players' },
	{ value: '/command ', description: 'Run Lua' },
	{ value: '/c ', description: 'Run Lua' },
	{ value: '/sc ', description: 'Run Lua without echoing it to players' }
];

export function commandCompletions(input: string) {
	const query = input.trimStart().toLowerCase();
	if (!query) return [];
	return consoleCommands
		.filter((command) => command.value.toLowerCase().startsWith(query) && command.value !== input)
		.slice(0, 8);
}

export function consoleLevel(text: string): 'error' | 'warning' | 'info' {
	if (
		/^(?:\s*\d+(?:\.\d+)?\s+)?(?:error|failed|exception|fatal)\b|\[(?:error|fatal)\]/iu.test(text)
	)
		return 'error';
	if (/^(?:\s*\d+(?:\.\d+)?\s+)?(?:warn(?:ing)?|deprecated)\b|\[warn(?:ing)?\]/iu.test(text))
		return 'warning';
	return 'info';
}

export function isLuaLine(text: string) {
	return /^\s*(?:\/(?:c|sc|command|silent-command)\b|(?:local|function|end|if|then|else|elseif|for|do|while|return|repeat|until)\b|--|[{}]|[\w.]+\s*(?:[=(]))/u.test(
		text
	);
}
export const tokenClass = (kind: string) =>
	(
		({
			command: 'text-cyan-300',
			string: 'text-emerald-300',
			number: 'text-amber-300',
			keyword: 'text-purple-300',
			comment: 'text-zinc-500'
		}) as Record<string, string>
	)[kind] ?? '';

export function highlightCommand(text: string): { text: string; kind: string }[] {
	const pattern =
		/(--[^\n]*|\[(=*)\[[\s\S]*?\]\2\]|\/[-a-z]+\b|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:local|function|end|if|then|else|elseif|for|in|do|while|repeat|until|break|return|true|false|nil|and|or|not)\b|\b\d+(?:\.\d+)?\b|\b(?:game|rcon|remote|script|commands|helpers|prototypes|storage)\b)/gu;
	const tokens: { text: string; kind: string }[] = [];
	let position = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > position)
			tokens.push({ text: text.slice(position, match.index), kind: 'plain' });
		const value = match[0];
		tokens.push({
			text: value,
			kind: value.startsWith('--')
				? 'comment'
				: value.startsWith('[')
					? 'string'
					: value.startsWith('/')
						? 'command'
						: /^["']/u.test(value)
							? 'string'
							: /^\d/u.test(value)
								? 'number'
								: 'keyword'
		});
		position = match.index + value.length;
	}
	if (position < text.length) tokens.push({ text: text.slice(position), kind: 'plain' });
	return tokens;
}

// Factorio mixes elapsed process times, wall-clock events, and untimed continuation lines.
export function parseConsoleLine(text: string) {
	const match =
		/^\s*(?:(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})|(\d+\.\d+))\s+(?:\[([A-Z]+)\]\s*|(Info|Warning|Error|Debug|Verbose|Fatal)\s+)?(.*)$/u.exec(
			text
		);
	if (!match) return { text, timestamp: '', level: '', clock: '' };
	return {
		text: match[5] ?? text,
		timestamp: match[1] ?? `+${match[2]}s`,
		level: (match[3] ?? match[4] ?? '').toUpperCase(),
		clock: match[1] ? 'Server time' : 'Time since Factorio started'
	};
}
