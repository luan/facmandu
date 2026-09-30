<script lang="ts">
 import Prompt from '$lib/components/Prompt.svelte';
	import { PlayIcon, PauseIcon, CheckIcon, CopyIcon, DownloadIcon, EraserIcon } from '@lucide/svelte';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { deserialize } from '$app/forms';
	import { MAX_CONSOLE_LINES, boundedConsoleLines, consoleText, RCON_COMMAND_BYTES, commandCompletions, consoleLevel, parseConsoleLine, highlightCommand, isLuaLine, tokenClass } from '$lib/console';
	import type { LogPacket } from '$lib/server/server-logs';
	import Button from '$lib/components/ui/button/button.svelte';
	let { serverId, serverName, running }: { serverId: string; serverName: string; running: boolean } = $props();
	type Entry = { id: string; text: string; time: number | null; source: 'log' | 'command' | 'response'; level: 'error' | 'warning' | 'info' };
	const LIMIT = MAX_CONSOLE_LINES;
	const ROW_HEIGHT = 22;
	let entries = $state<Entry[]>([]);
	let pending: Entry[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	const seen = new Set<string>();
	let paused = $state(false);
	let follow = $state(true);
	let unread = $state(0);
	let filter = $state('');
	let level = $state('all');
	let source = $state('all');
	let connection = $state('connecting');
	let viewport = $state<HTMLDivElement>();
	let input = $state<HTMLTextAreaElement>();
	let scrollTop = $state(0);
	let viewportHeight = $state(440);
	let command = $state('');
	let sending = $state(false);
	const commandBytes = $derived(new TextEncoder().encode(command).byteLength);
	let history: string[] = [];
	let historyIndex = -1;
	let historyDraft = '';
	let completionIndex = $state(0);
	let completionsHidden = $state(false);
	let copied = $state(false);
	const matches = $derived(completionsHidden ? [] : commandCompletions(command));
	const filtered = $derived(entries.filter((entry) => (level === 'all' || entry.level === level) && (source === 'all' || entry.source === source) && (!filter || entry.text.toLowerCase().includes(filter.toLowerCase()))));
	const first = $derived(Math.max(0, Math.min(filtered.length - 1, Math.floor(scrollTop / ROW_HEIGHT) - 8)));
	const visible = $derived(filtered.slice(first, first + Math.ceil(viewportHeight / ROW_HEIGHT) + 16));
	const highlighted = $derived(highlightCommand(command));

	$effect(() => { void filter; void level; void source; scrollTop = 0; copied = false; if (viewport) viewport.scrollTop = 0; });
	function enqueue(entry: Entry) {
		if (seen.has(entry.id)) return;
		seen.add(entry.id);
		for (const [index, text] of entry.text.split(/\r?\n/u).entries()) {
   pending.push({ ...entry, id: index ? `${entry.id}:${index}` : entry.id, text: consoleText(text) });
  }
		flushTimer ??= setTimeout(() => { void flush(); }, 100);
		pending = boundedConsoleLines(pending);
		// IDs only cover the bounded replay window, plus commands displayed in this session.
		if (seen.size > LIMIT * 3) { seen.clear(); for (const item of [...entries, ...pending]) seen.add(item.id); }
	}
	async function flush() {
		clearTimeout(flushTimer); flushTimer = undefined;
		if (!pending.length) return;
		if (paused) { unread = pending.length; return; }
		entries = boundedConsoleLines([...entries, ...pending]);
		copied = false;
		pending = [];
		unread = 0;
		if (follow) { await tick(); if (viewport) viewport.scrollTop = viewport.scrollHeight; }
	}
	function clearDisplay() { entries = []; pending = []; unread = 0; scrollTop = 0; copied = false; }
	function onScroll() {
		if (!viewport) return;
		scrollTop = viewport.scrollTop;
		follow = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < ROW_HEIGHT * 2;
	}
	async function resume() { paused = false; follow = true; await flush(); await tick(); if (viewport) viewport.scrollTop = viewport.scrollHeight; }
	function complete(value: string) { command = value; completionIndex = 0; completionsHidden = true; input?.focus(); }
	function keydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); clearDisplay(); return; }
		if (event.key === 'Escape') { completionsHidden = true; return; }
		const match = matches[completionIndex % matches.length];
		if (event.key === 'Tab' && match) { event.preventDefault(); complete(match.value); return; }
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
			event.preventDefault(); completionIndex = (completionIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; return;
		}
		if (event.key === 'ArrowUp' && !event.shiftKey && !command.includes('\n')) {
			event.preventDefault(); if (historyIndex === -1) historyDraft = command;
			historyIndex = Math.min(historyIndex + 1, history.length - 1);
			command = history[historyIndex] ?? command; completionsHidden = true;
		} else if (event.key === 'ArrowDown' && historyIndex >= 0 && !command.includes('\n')) {
			event.preventDefault(); historyIndex--; command = historyIndex < 0 ? historyDraft : (history[historyIndex] ?? historyDraft); completionsHidden = true;
		}
	}
	async function send() {
		const value = command.trim();
		if (!value || sending || !running || commandBytes > RCON_COMMAND_BYTES) return;
		if (!/password|token|secret/iu.test(value)) {
			history = [value, ...history.filter((item) => item !== value)].slice(0, 100);
			try { sessionStorage.setItem(`facmandu:commands:${page.data.user?.id}:${serverId}`, JSON.stringify(history)); } catch { /* History is optional when browser storage is unavailable. */ }
		}
		historyIndex = -1; historyDraft = ''; command = ''; sending = true;
		enqueue({ id: crypto.randomUUID(), text: value, time: Date.now(), source: 'command', level: 'info' });
		paused = false; follow = true; await flush();
		try {
			const fields = new FormData(); fields.set('operation', 'rcon'); fields.set('command', value);
			const response = await fetch(`/servers/${serverId}?/manage&tab=console`, { method: 'POST', headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }, body: fields });
			const result = deserialize(await response.text());
			const output = result.type === 'success' ? String(result.data?.output || '') : result.type === 'failure' ? String(result.data?.message || 'Command failed') : 'Command failed';
			for (const text of output.split(/\r?\n/u).filter(Boolean).slice(-LIMIT)) enqueue({ id: crypto.randomUUID(), text, time: Date.now(), source: 'response', level: result.type === 'success' ? consoleLevel(text) : 'error' });
		} catch {
			enqueue({ id: crypto.randomUUID(), text: 'Connection failed. The command may have reached the server; check its output before retrying.', time: Date.now(), source: 'response', level: 'error' });
		} finally { sending = false; await flush(); input?.focus(); }
	}
	async function copy() {
		try { await navigator.clipboard.writeText(filtered.map((entry) => entry.text).join('\n')); copied = true; } catch { copied = false; }
	}
	function download() {
		const url = URL.createObjectURL(new Blob([filtered.map((entry) => `${entry.time ? new Date(entry.time).toISOString() : ''} [${entry.source}] ${entry.text}`).join('\n')], { type: 'text/plain' }));
		const link = document.createElement('a'); link.href = url; link.download = `${serverName}-console.log`; link.click(); URL.revokeObjectURL(url);
	}
	onMount(() => {
		try { const saved: unknown = JSON.parse(sessionStorage.getItem(`facmandu:commands:${page.data.user?.id}:${serverId}`) ?? '[]'); if (Array.isArray(saved)) history = saved.filter((item): item is string => typeof item === 'string').slice(0, 100); } catch { /* Ignore old or invalid history. */ }
		const stream = new EventSource(`/servers/${serverId}/logs`);
		stream.onmessage = (event) => {
			try {
				const packet: LogPacket = JSON.parse(event.data);
				if (packet.type === 'connection') connection = packet.state;
				else if (packet.type === 'lines') for (const line of packet.lines) enqueue({ ...line, source: 'log', level: consoleLevel(line.text) });
			} catch { connection = 'reconnecting'; }
		};
		stream.onerror = () => { connection = 'reconnecting'; };
		return () => { clearTimeout(flushTimer); stream.close(); };
	});
</script>

<section class="flex h-[32rem] min-h-0 flex-none flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-200 sm:h-auto sm:flex-1" aria-label={`${serverName} console`}>
	<div class="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3 text-xs">
		{#if connection !== 'live'}<span role="status" class="text-amber-300">{connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>{/if}
		<span class="text-zinc-500">{entries.length.toLocaleString()} lines</span>
		<div class="ml-auto flex gap-1"><Button variant="ghost" size="sm" onclick={() => { paused = !paused; if (!paused) void flush(); }}>{#if paused}<PlayIcon class="size-4" />{:else}<PauseIcon class="size-4" />{/if}{paused ? `Resume${unread ? ` (${unread})` : ''}` : 'Pause'}</Button><Button variant="ghost" size="sm" onclick={copy}>{#if copied}<CheckIcon class="size-4" />{:else}<CopyIcon class="size-4" />{/if}{copied ? 'Copied' : 'Copy'}</Button><Button variant="ghost" size="sm" onclick={download}><DownloadIcon class="size-4" />Download</Button><Button variant="ghost" size="sm" onclick={clearDisplay}><EraserIcon class="size-4" />Clear</Button></div>
	</div>
	<div class="flex flex-wrap gap-2 border-b border-zinc-800 p-3">
		<input aria-label="Filter console output" placeholder="Find in output…" bind:value={filter} oninput={() => { scrollTop = 0; if (viewport) viewport.scrollTop = 0; copied = false; }} class="min-w-40 flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-zinc-500" />
		<select aria-label="Filter log level" bind:value={level} class="rounded border border-zinc-700 bg-zinc-900 px-2 text-xs"><option value="all">All levels</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="info">Info</option></select>
		<select aria-label="Filter output source" bind:value={source} class="rounded border border-zinc-700 bg-zinc-900 px-2 text-xs"><option value="all">All output</option><option value="log">Server logs</option><option value="command">Commands</option><option value="response">Responses</option></select>
	</div>
	<div class="relative min-h-0 flex-1">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus and scroll console output.) -->
		<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus and scroll console output. -->
		<div bind:this={viewport} bind:clientHeight={viewportHeight} onscroll={onScroll} class="h-full overflow-auto font-mono text-xs outline-none focus:ring-1 focus:ring-inset focus:ring-zinc-500" role="log" aria-label="Console output" aria-live="off" tabindex="0">
			{#if !filtered.length}<p class="px-4 py-6 text-zinc-500">{entries.length ? 'No matching output.' : 'No output yet.'}</p>{/if}
			<div style:height={`${filtered.length * ROW_HEIGHT}px`} class="relative min-w-full">
				{#each visible as entry, index (entry.id)}
 {@const parsed = parseConsoleLine(entry.text)}
					<div class="absolute flex min-w-full gap-3 whitespace-pre px-4 leading-[22px]" style:top={`${(first + index) * ROW_HEIGHT}px`}><span class="w-[10ch] shrink-0 text-right text-zinc-500" ><span class="sr-only">{parsed.timestamp ? `${parsed.clock}: ${parsed.timestamp.includes(' ') ? parsed.timestamp.split(' ')[0] : ''} ` : ''}</span>{entry.time ? new Date(entry.time).toLocaleTimeString([], { hour12: false }) : parsed.timestamp.includes(' ') ? parsed.timestamp.split(' ')[1] : parsed.timestamp}</span><span class="w-[7ch] shrink-0 text-zinc-500">{parsed.level}</span>{#if entry.source !== 'log'}<span role="img" class="w-3 shrink-0 text-cyan-400" aria-label={entry.source === 'command' ? 'Command' : 'Response'}>{entry.source === 'command' ? '❯' : '←'}</span>{/if}<span class={entry.level === 'error' ? 'text-red-400' : entry.level === 'warning' ? 'text-amber-300' : 'text-zinc-300'}>{#if entry.source === 'command' || isLuaLine(parsed.text)}{#each highlightCommand(parsed.text) as token, tokenIndex (tokenIndex)}<span class={tokenClass(token.kind)}>{token.text}</span>{/each}{:else}{parsed.text}{/if}</span></div>
				{/each}
			</div>
		</div>
		{#if !follow || paused}<button type="button" onclick={resume} class="absolute right-4 bottom-3 rounded-full border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs shadow-lg">{paused ? 'Resume & follow' : 'Jump to latest'} ↓</button>{/if}
	</div>
	<form onsubmit={(event) => { event.preventDefault(); void send(); }} class="relative border-t border-zinc-800 p-3">
		{#if matches.length}<div class="absolute right-3 bottom-full left-3 z-10 mb-1 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl" id="console-completions" role="listbox" aria-label="Command completions">{#each matches as match, index (match.value)}<button id={`completion-${index}`} type="button" role="option" aria-selected={index === completionIndex} class={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-xs ${index === completionIndex ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`} onclick={() => complete(match.value)}><span class="font-mono text-cyan-300">{match.value}</span><span class="truncate text-zinc-400">{match.description}</span></button>{/each}</div>{/if}
        <Prompt bind:value={command} bind:element={input} label="RCON command" placeholder="Command…" maxLength={RCON_COMMAND_BYTES} busy={sending} disabledReason={!running ? 'Start the server to send commands' : commandBytes > RCON_COMMAND_BYTES ? 'Command exceeds the byte limit' : ''} tokens={highlighted} completionId={matches.length ? 'console-completions' : undefined} activeOption={matches.length ? `completion-${completionIndex % matches.length}` : undefined} onkeydown={keydown} oninput={() => { completionsHidden = false; completionIndex = 0; historyIndex = -1; }} {send} />
	</form>
</section>
