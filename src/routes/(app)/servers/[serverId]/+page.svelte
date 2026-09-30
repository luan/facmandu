<script module lang="ts">
	import type { ServerView } from '$lib/server/server-view';
	const views = new Map<string, { data: ServerView; expiresAt: number; completions: Record<string, number> }>();
</script>
<script lang="ts">
	import Assistant from '$lib/components/Assistant.svelte';
	import InstanceSettings from './InstanceSettings.svelte';
	import { RefreshCwIcon, PlayIcon, SquareIcon, PackageIcon, HardDriveIcon, TerminalIcon, SettingsIcon, ShieldCheckIcon } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
	import { untrack } from 'svelte';
	import { watchServerStatus } from '$lib/server-status';
	import { getActivityState } from '$lib/activity.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import ServerWorkspace from './ServerWorkspace.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let view = $state<ServerView | null>(null);
	let lastView = $state<{ serverId: string; data: ServerView } | null>(null);
	const headerView = $derived(view ?? (lastView?.serverId === data.server.id ? lastView.data : null));
	let loading = $state(true);
	let statusSnapshot = $state<{ serverId: string; status: ServerView['status'] } | null>(null);
	const headerStatus = $derived(statusSnapshot?.serverId === data.server.id ? statusSnapshot.status : headerView?.status);
	let errorMessage = $state('');
	let connectionLost = $state(false);
	let completions = $state<Record<string, number>>({});
	let requestNumber = 0;
	const activityState = getActivityState();
	const base = $derived(`/servers/${data.server.id}`);
	const query = $derived(new URLSearchParams({ tab: data.activeTab, ...(data.selectedListId ? { list: data.selectedListId } : {}) }));
	const cacheKey = $derived(`${data.user?.id}:${base}?${query}&connection=${encodeURIComponent(data.server.directory)}`);
	const tabs = [{ id: 'console', icon: TerminalIcon, label: 'Console' }, { id: 'mods', icon: PackageIcon, label: 'Mods' }, { id: 'saves', icon: HardDriveIcon, label: 'Saves' }, { id: 'settings', icon: SettingsIcon, label: 'Settings' }, { id: 'access', icon: ShieldCheckIcon, label: 'Access' }];
	let lifecyclePending = $state(false);
	const task = $derived(activityState.items.find((item) => item.scope === 'server' && item.targetId === data.server.id && item.state === 'running'));
	const stopping = $derived(task?.task === 'stop' || headerStatus?.stopping);
	const startReason = $derived(!view ? 'Loading server details' : lifecyclePending ? 'Updating server' : task?.message || (headerView?.modSyncJob?.status === 'running' ? 'Applying mod list' : !headerView?.status.is_configured ? 'Select a Factorio version in Settings' : ''));
	const manageLifecycle: import('@sveltejs/kit').SubmitFunction = ({ cancel }) => {
		if (startReason) { cancel(); return; }
		lifecyclePending = true;
		return async ({ update, result }) => {
			try {
				if (result.type === 'error') { toast.error(result.error.message || 'Could not update server'); return; }
				await update({ reset: false, invalidateAll: false });
				if (result.type === 'success') await refresh();
			} finally { lifecyclePending = false; }
		};
	};

	function tabHref(tab: string) { const params = new URLSearchParams(query); params.set('tab', tab); return `${base}?${params}`; }
	async function loadView(key: string, url: string, signal?: AbortSignal) {
		const observed = untrack(() => Object.fromEntries(activityState.items.filter((item) => item.state !== 'running').map((item) => [item.key, item.updatedAt])));
		const request = ++requestNumber;
		// A failed refresh still consumes that completion event; retry remains explicit.
		completions = observed;
		loading = true;
		errorMessage = '';
		try {
			const response = await fetch(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]) });
			if (!response.ok) throw new Error('Could not load this section.');
			const result: ServerView = await response.json();
			if (signal?.aborted || key !== cacheKey || request !== requestNumber) return;
			if (views.size >= 50) { const oldest = views.keys().next().value; if (oldest) views.delete(oldest); }
			views.set(key, { data: result, expiresAt: Date.now() + 15_000, completions: observed });
			view = result;
			statusSnapshot = { serverId: data.server.id, status: result.status };
			lastView = { serverId: data.server.id, data: result };
			completions = observed;
		} catch (cause) {
			if (!signal?.aborted && key === cacheKey && request === requestNumber) {
				const message = cause instanceof DOMException && cause.name === 'TimeoutError' ? 'This section is taking too long to load.' : 'Could not load this section.';
				if (view) toast.error(message);
				else errorMessage = message;
			}
		} finally {
			if (!signal?.aborted && key === cacheKey && request === requestNumber) loading = false;
		}
	}
	async function refresh() {
		for (const key of views.keys()) if (key.startsWith(`${data.user?.id}:${base}?`)) views.delete(key);
		await loadView(cacheKey, `${base}/data?${query}&fresh=1`);
	}
	$effect(() => {
		const key = cacheKey;
		const cached = views.get(key);
		view = cached?.data ?? null;
		if (cached) lastView = { serverId: data.server.id, data: cached.data };
		completions = cached?.completions ?? {};
		errorMessage = '';
		const fresh = cached && cached.expiresAt > Date.now();
		loading = !fresh;
		if (fresh) return;
		const controller = new AbortController();
		void loadView(key, `${base}/data?${query}`, controller.signal);
		return () => controller.abort();
	});
	$effect(() => watchServerStatus(data.server.id, (status) => {
        connectionLost = false;
        statusSnapshot = { serverId: data.server.id, status };
        if (view) view = { ...view, status };
        if (lastView?.serverId === data.server.id) lastView = { ...lastView, data: { ...lastView.data, status } };
    }, () => { connectionLost = true; }));
	$effect(() => {
		if (!view || loading) return;
		// Activity revisions come from the server; browser and server wall clocks can differ.
		const completed = activityState.items.some((item) => item.state !== 'running' && completions[item.key] !== item.updatedAt && (
			(item.scope === 'server' && item.targetId === data.server.id) ||
			(data.activeTab === 'mods' && item.scope === 'modlist' && item.targetId === data.selectedListId)
		));
		if (completed) void refresh();
	});
</script>
<svelte:head><title>{data.server.name} · Facmandu</title></svelte:head>
<div class={`workbench flex flex-col gap-0 ${data.activeTab === 'console' ? 'server-workbench' : 'pb-12'}`}>
	<div class="window-title flex flex-wrap items-center justify-between gap-4">
		<div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"><div class="flex items-center gap-3"><a href="/servers" class="text-muted-foreground text-sm">Servers</a><span class="text-muted-foreground">/</span><h1 class="text-xl font-semibold">{data.server.name}</h1><InstanceSettings server={data.server} /></div>
			{#if headerStatus}<div role="status" aria-label="Server status" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<span class="inline-flex items-center gap-2 font-semibold"><span class={`size-2 rounded-full ${connectionLost || stopping ? 'bg-amber-400' : headerStatus.failed ? 'bg-red-400' : headerStatus.running ? 'bg-emerald-500' : 'bg-muted-foreground'}`}></span>{connectionLost ? 'Reconnecting…' : stopping ? 'Stopping…' : headerStatus.running ? 'Running' : headerStatus.failed ? 'Failed to start' : 'Stopped'}</span>
				<span class="text-muted-foreground">Factorio {headerStatus.version.version || 'not selected'}</span>
				{#if headerView}<span class="text-muted-foreground">{headerView.selectedSave || 'Latest save'}</span>
				<span class="text-muted-foreground">{headerView.mods.filter((mod) => mod.enabled).length} enabled mods</span>{/if}
			</div>{:else}<div role="status" aria-label="Loading server status" class="flex items-center gap-3">{#if connectionLost}<span class="text-sm text-muted-foreground">Reconnecting…</span>{:else}<span class="bg-muted h-4 w-20 motion-safe:animate-pulse"></span><span class="bg-muted h-4 w-28 motion-safe:animate-pulse"></span>{/if}</div>{/if}
		</div>
		<div class="flex items-center gap-3">
			{#if data.servers.length > 1}<select aria-label="Switch server" class="bg-background max-w-52 rounded-md border px-3 py-2 text-sm" value={data.server.id} onchange={(event) => void goto(`/servers/${event.currentTarget.value}?tab=${data.activeTab}`)}>{#each data.servers as server (server.id)}<option value={server.id}>{server.name}</option>{/each}</select>{/if}
			{#if headerStatus}<form method="POST" action={`?/manage&${query}`} use:enhance={manageLifecycle}>
				<input type="hidden" name="operation" value={headerStatus.running ? 'stop' : 'start'} />
				<TooltipButton tooltip={startReason || (headerStatus.running ? 'Stop server' : 'Start server')} type="submit" size="sm" disabled={!!startReason} variant={headerStatus.running ? 'destructive' : 'default'}>{#if headerStatus.running}<SquareIcon class="size-4" />{:else}<PlayIcon class="size-4" />{/if}{stopping ? 'Stopping…' : headerStatus.running ? 'Stop' : 'Start'}</TooltipButton>
			</form>{:else}<span aria-hidden="true" class="bg-muted h-8 w-20 motion-safe:animate-pulse"></span>{/if}
			{#key data.server.id}<Assistant serverId={data.server.id} />{/key}
			<Button variant="outline" size="sm" onclick={refresh} disabled={loading}><RefreshCwIcon class={`size-4 ${loading ? 'motion-safe:animate-spin' : ''}`} />Refresh</Button>
		</div>
	</div>
	<nav aria-label="Server sections" class="factory-tabs">
		{#each tabs as tab (tab.id)}<a href={tabHref(tab.id)} aria-current={data.activeTab === tab.id ? 'page' : undefined} class="factory-tab inline-flex items-center justify-center gap-2"><tab.icon class="size-4 shrink-0" />{tab.label}</a>{/each}
	</nav>
	<div aria-busy={loading} class="factory-panel server-content flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
	{#if errorMessage}<div role="alert" class="flex min-h-32 items-center justify-center gap-2 text-sm">{errorMessage} <Button variant="link" size="sm" onclick={refresh}><RefreshCwIcon class="size-4" />Retry</Button></div>{/if}
	{#if headerView}
		{#key data.server.id}<ServerWorkspace data={{ ...headerView, server: data.server, modLists: data.modLists, activeTab: view ? data.activeTab : 'loading', selectedListId: data.selectedListId }} {refresh} />{/key}
	{/if}
	{#if !view && !errorMessage}
		<div role="status" aria-label={`Loading ${data.activeTab}`} class={`min-h-64 space-y-4 motion-safe:animate-pulse ${data.activeTab === 'console' ? 'flex-1 bg-background p-4' : ''}`}>
			{#if data.activeTab === 'console'}
				<div aria-hidden="true" class="flex items-center justify-between border-b pb-4"><span class="h-3 w-16 bg-muted"></span><span class="h-6 w-48 bg-muted"></span></div>
				<div aria-hidden="true" class="space-y-4 py-3">{#each [55, 75, 40, 65, 50, 80] as width}<div class="h-3 bg-muted" style:width={`${width}%`}></div>{/each}</div>
			{:else if data.activeTab === 'settings' || data.activeTab === 'access'}
				<div aria-hidden="true" class={`grid gap-4 ${data.activeTab === 'access' ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
					{#each (data.activeTab === 'access' ? [1, 2, 3] : [1, 2]) as panel (panel)}
						<div class="border border-border"><div class="border-b p-4"><div class="h-4 w-32 bg-muted"></div></div><div class="space-y-4 p-4"><div class="h-4 w-2/3 bg-muted"></div><div class="h-8 w-full bg-muted"></div></div></div>
					{/each}
				</div>
				{#if data.activeTab === 'settings'}<div aria-hidden="true" class="border border-border p-4"><div class="mb-6 h-4 w-32 bg-muted"></div>{#each [1, 2, 3, 4] as row (row)}<div class="mb-3 grid grid-cols-[1fr_2fr] items-center gap-4"><span class="h-3 w-24 bg-muted"></span><span class="h-8 bg-muted"></span></div>{/each}</div>{/if}
			{:else}
				<div aria-hidden="true" class="flex h-8 items-center justify-between gap-4"><span class="h-4 w-32 bg-muted"></span><div class="flex gap-2"><span class="h-8 w-20 bg-muted"></span><span class="h-8 w-28 bg-muted"></span></div></div>
				<div aria-hidden="true" class="divide-y divide-border border border-border">
					{#each [1, 2, 3] as row (row)}
						<div class="flex items-center gap-4 p-4"><span class="size-8 shrink-0 bg-muted"></span><div class="flex-1 space-y-2"><div class="h-4 w-40 max-w-full bg-muted"></div><div class="h-3 w-60 max-w-full bg-muted"></div></div><span class="h-6 w-16 bg-muted"></span></div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
</div>
