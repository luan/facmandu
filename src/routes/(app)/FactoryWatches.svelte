<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { BellIcon, LoaderCircleIcon, PlusIcon, Trash2Icon } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { buttonVariants } from '$lib/components/ui/button';
	import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';

	type Watch = { id: string; serverId: string; kind: 'research_stalled' | 'item_deficit'; force: string; surface: string | null; item: string | null; enabled: boolean; validated: boolean; validationError: string | null };
	type Alert = { id: string; serverId: string; message: string; createdAt: string; readAt: string | null };
	let { servers }: { servers: { id: string; name: string }[] } = $props();
	let open = $state(false);
	let selected = $state('');
	let watches = $state<Watch[]>([]);
	let alerts = $state<Alert[]>([]);
	let alertsLoaded = $state(false);
	let alertLoadError = $state('');
	let loadingWatches = $state(false);
	let loadError = $state('');
	let pending = $state(false);
	let showForm = $state(false);
	let kind = $state<'research_stalled' | 'item_deficit'>('research_stalled');
	let force = $state('player');
	let surface = $state('nauvis');
	let item = $state('iron-plate');
	const unread = $derived(alerts.filter((alert) => !alert.readAt).length);
	const serverName = (id: string) => servers.find((server) => server.id === id)?.name ?? 'Server';
	async function responseError(response: Response) {
		const body: unknown = await response.json().catch(() => null);
		return body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
			? body.message : `Request failed (${response.status})`;
	}

	async function loadAlerts() {
		try {
			const response = await fetch('/api/factory-alerts');
			if (!response.ok) throw new Error(await responseError(response));
			const next: Alert[] = await response.json();
			alerts = next.map((alert) => ({ ...alert, readAt: alert.readAt ?? alerts.find((current) => current.id === alert.id)?.readAt ?? null }));
			alertsLoaded = true;
			alertLoadError = '';
		} catch (cause) { alertLoadError = cause instanceof Error ? cause.message : 'Could not load alerts'; }
	}
	async function loadWatches() {
		const serverId = selected;
		if (!serverId) { watches = []; return; }
		watches = [];
		loadingWatches = true;
		loadError = '';
		try {
			const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/watches`);
			if (!response.ok) throw new Error(await responseError(response));
			const next: Watch[] = await response.json();
			if (selected === serverId) watches = next;
		} catch (cause) {
			if (selected === serverId) loadError = cause instanceof Error ? cause.message : 'Could not load watches';
		} finally { if (selected === serverId) loadingWatches = false; }
	}
	async function changeWatch(watch: Watch, method: 'PATCH' | 'DELETE') {
		if (pending) return;
		pending = true;
		try {
			const response = await fetch(`/api/servers/${encodeURIComponent(watch.serverId)}/watches/${encodeURIComponent(watch.id)}`, {
				method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: method === 'PATCH' ? JSON.stringify({ enabled: !watch.enabled }) : undefined
			});
			if (!response.ok) throw new Error(await responseError(response));
			await loadWatches();
		} catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not update watch'); }
		finally { pending = false; }
	}
	async function createWatch(event: SubmitEvent) {
		event.preventDefault();
		if (pending || !selected) return;
		pending = true;
		const input = kind === 'research_stalled' ? { kind, force: force.trim() } : { kind, force: force.trim(), surface: surface.trim(), item: item.trim() };
		try {
			const response = await fetch(`/api/servers/${encodeURIComponent(selected)}/watches`, {
				method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(input)
			});
			if (!response.ok) throw new Error(await responseError(response));
			const created: Watch = await response.json();
			toast.success(created.validated ? 'Watch created' : 'Watch saved; names will be checked when the server starts');
			showForm = false;
			await loadWatches();
		} catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not create watch'); }
		finally { pending = false; }
	}
	async function markRead(alert: Alert) {
		try {
			const response = await fetch('/api/factory-alerts', {
				method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id: alert.id })
			});
			if (!response.ok) throw new Error(await responseError(response));
			const updated: Alert = await response.json();
			alerts = alerts.map((item) => item.id === alert.id ? updated : item);
		} catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not mark alert read'); }
	}
	$effect(() => { if (open) void loadWatches(); });
	onMount(() => {
		selected = servers[0]?.id ?? '';
		void loadAlerts();
		const events = new EventSource('/api/factory-alerts/events');
		events.onmessage = (message) => {
			try {
				const alert: Alert = JSON.parse(message.data);
				alerts = [alert, ...alerts.filter((item) => item.id !== alert.id)].slice(0, 100);
				toast.warning(alert.message);
			} catch { void loadAlerts(); }
		};
		const timer = setInterval(() => { void loadAlerts(); }, 30_000);
		const visible = () => { if (document.visibilityState === 'visible') void loadAlerts(); };
		document.addEventListener('visibilitychange', visible);
		return () => { events.close(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
	});
</script>

<Sheet.Root bind:open>
	<Sheet.Trigger class={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label={`Factory alerts${unread ? `: ${unread} unread` : ''}`}>
		<BellIcon class="size-4" />
		<span class={`inline-flex w-5 justify-center text-amber-500 ${unread ? '' : 'invisible'}`} aria-hidden="true">{Math.min(unread, 99)}</span>
		<span class="hidden md:inline">Alerts</span>
	</Sheet.Trigger>
	<Sheet.Content class="w-full sm:max-w-md">
		<Sheet.Header><Sheet.Title>Factory alerts</Sheet.Title><Sheet.Description class="sr-only">Recent alerts and saved watches</Sheet.Description></Sheet.Header>
		<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4 text-sm">
			<section class="space-y-2" aria-label="Recent alerts">
				<h3 class="font-semibold">Recent alerts</h3>
				{#each alerts as alert (alert.id)}
					<article class="rounded-lg border p-3">
						<p class="font-medium">{serverName(alert.serverId)}{#if !alert.readAt}<span class="ml-2 text-amber-500">New</span>{/if}</p>
						<p>{alert.message}</p>
						<div class="mt-2 flex items-center justify-between text-xs text-muted-foreground"><time>{new Date(alert.createdAt).toLocaleString()}</time>{#if !alert.readAt}<TooltipButton type="button" size="sm" variant="ghost" tooltip="Mark this alert read" onclick={() => markRead(alert)}>Mark read</TooltipButton>{/if}</div>
					</article>
				{:else}{#if alertLoadError}<p role="alert" class="text-destructive">{alertLoadError}</p>{:else if !alertsLoaded}<p class="text-muted-foreground">Loading alerts…</p>{:else}<p class="text-muted-foreground">No alerts yet</p>{/if}{/each}
			</section>
			<section class="space-y-3 border-t pt-4" aria-label="Factory watches">
				<h3 class="font-semibold">Watches</h3>
				<label class="block space-y-1">Server<select class="w-full rounded-md border bg-background p-2" bind:value={selected}>
					{#each servers as server}<option value={server.id}>{server.name}</option>{/each}
				</select></label>
				{#if loadError}<p role="alert" class="text-destructive">{loadError}</p>{/if}
				{#if loadingWatches}<p class="text-muted-foreground">Loading watches…</p>{/if}
				{#each watches as watch (watch.id)}
					<div class="flex items-center gap-2 rounded-lg border p-3">
						<div class="min-w-0 flex-1"><p class="font-medium">{watch.kind === 'research_stalled' ? 'Research stalled' : 'Consumption exceeds production'}</p><p class="truncate text-muted-foreground">{watch.force}{watch.item ? ` · ${watch.item} · ${watch.surface}` : ''}</p>{#if watch.validationError}<p class="text-destructive">{watch.validationError}</p>{:else if !watch.validated}<p class="text-muted-foreground">Pending validation</p>{/if}</div>
						<TooltipButton type="button" variant="ghost" size="sm" tooltip={watch.enabled ? 'Pause this watch' : 'Resume this watch'} disabled={pending} onclick={() => changeWatch(watch, 'PATCH')}>{watch.enabled ? 'Pause' : 'Resume'}</TooltipButton>
						<TooltipButton type="button" variant="ghost" size="icon" tooltip="Remove watch" aria-label="Remove watch" disabled={pending} onclick={() => changeWatch(watch, 'DELETE')}><Trash2Icon class="size-4" /></TooltipButton>
					</div>
				{:else}{#if !loadingWatches && !loadError}<p class="text-muted-foreground">No watches on this server</p>{/if}{/each}
				{#if showForm}<form class="space-y-2 border-t pt-3" onsubmit={createWatch}>
					<h4 class="font-medium">New watch</h4>
					<label class="block space-y-1">Condition<select class="w-full rounded-md border bg-background p-2" bind:value={kind}><option value="research_stalled">Research stalls for 5 minutes</option><option value="item_deficit">Item consumption exceeds production</option></select></label>
					<label class="block space-y-1">Force<input class="w-full rounded-md border bg-background p-2" bind:value={force} required maxlength="100" /></label>
					{#if kind === 'item_deficit'}
						<label class="block space-y-1">Surface<input class="w-full rounded-md border bg-background p-2" bind:value={surface} required maxlength="100" /></label>
						<label class="block space-y-1">Item prototype<input class="w-full rounded-md border bg-background p-2" bind:value={item} required maxlength="100" /></label>
					{/if}
					<TooltipButton type="submit" variant="secondary" size="sm" tooltip={pending ? 'Saving watch' : 'Create this watch'} disabled={!selected || pending}>{#if pending}<LoaderCircleIcon class="size-4 animate-spin" />{/if}{pending ? 'Adding…' : 'Add watch'}</TooltipButton>
				</form>{:else}<TooltipButton type="button" variant="secondary" size="sm" tooltip="Create a factory watch" onclick={() => { showForm = true; }}><PlusIcon class="size-4" />New watch</TooltipButton>{/if}
			</section>
		</div>
	</Sheet.Content>
</Sheet.Root>
