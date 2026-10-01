<script lang="ts">
	import { RefreshCwIcon, LoaderCircleIcon, ListChecksIcon, CheckIcon, DownloadIcon, CircleStopIcon, CirclePlayIcon, TrashIcon, LinkIcon, SaveIcon, ShieldCheckIcon, PlusIcon, XIcon, SearchIcon, PackageIcon } from '@lucide/svelte';
	import { getActivityState } from '$lib/activity.svelte';
	import { compareVersions } from '$lib/dependencies';
	import { tick, untrack } from 'svelte';
	import { modThumbnailUrl } from '$lib/utils';
	import type { ModSettingsCatalog } from '$lib/server/mod-settings-defs';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import SettingInput from './SettingInput.svelte';
 import FactorioRichText from '$lib/components/FactorioRichText.svelte';
 import SettingHelp from './SettingHelp.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Card from '$lib/components/ui/card';
	import Console from './Console.svelte';
	import ServerBookmarks from './ServerBookmarks.svelte';
 import GameAssistantSettings from './GameAssistantSettings.svelte';
 import ServerSaves from './ServerSaves.svelte';
	import type { ServerView } from '$lib/server/server-view';
	import type { ServerSummary } from '$lib/server/servers';
	import type { ModList } from '$lib/server/db/schema';
	import type { AvailableVersions } from '$lib/server/server-versions';
	import type { SettingDef } from '$lib/server/mod-settings-lua';

	let { data, refresh }: { data: ServerView & { server: ServerSummary; modLists: ModList[]; activeTab: string; selectedListId: string | null }; refresh: () => Promise<void> } = $props();
	const activityState = getActivityState();
 const serverBusy = $derived(activityState.items.some((item) => item.scope === 'server' && item.targetId === data.server.id && item.state === 'running'));
 const loadedJob = $derived(data.modSyncJob);
 const loadedMods = $derived(data.mods);
 const base = $derived(`/servers/${data.server.id}`);
	const settingsActive = $derived(data.activeTab === 'settings');
	let availableVersions = $state<AvailableVersions>({});
	let releasesLoading = $state(false);
	let releasesOpen = $state(false);
	let releasesWarning = $state('');
	let releaseAttempt = $state(0);
	$effect(() => {
		if (!settingsActive || !releasesOpen) return;
		const url = `${base}/releases`;
		void releaseAttempt;
		const controller = new AbortController();
		releasesLoading = true;
		releasesWarning = '';
		void (async () => {
			try {
				const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
				if (!response.ok) throw new Error('Could not check the latest releases.');
				const result: { data: AvailableVersions | null; warning?: string } = await response.json();
				if (controller.signal.aborted) return;
				availableVersions = result.data ?? {};
				releasesWarning = result.warning ? 'Showing cached releases while Factorio.com is unavailable.' : '';
			} catch {
				if (!controller.signal.aborted) releasesWarning = 'Could not check the latest releases. Installed versions are still available.';
			} finally {
				if (!controller.signal.aborted) releasesLoading = false;
			}
		})();
		return () => controller.abort();
	});
	let settingsDraft = $state<Record<string, unknown>>({});
 let settingsBaseline = $state('');
 const settingsDirty = $derived(JSON.stringify(settingsDraft) !== settingsBaseline);
 $effect(() => {
  if (settingsActive && data.settings && untrack(() => !settingsBaseline || !settingsDirty)) {
   const parsed: Record<string, unknown> = JSON.parse(data.settings);
   settingsDraft = parsed;
   settingsBaseline = JSON.stringify(parsed);
  }
 });
 type SettingScope = SettingDef['settingType'];
 type ModValue = string | number | boolean | { r: number; g: number; b: number; a?: number };
 type ModDraft = Record<SettingScope, Record<string, { value: ModValue }>>;
 const emptyModDraft = (): ModDraft => ({ startup: {}, 'runtime-global': {}, 'runtime-per-user': {} });
 let modDraft = $state<ModDraft>(emptyModDraft());
 let modSaved = $state<ModDraft>(emptyModDraft());
 let modLoaded = $state(false);
 let modMode = $state<boolean | null>(null);
 function changedModSettings(draft: ModDraft, saved: ModDraft, running: boolean): ModDraft {
  const changes = emptyModDraft();
  for (const scope of (running ? ['runtime-global'] : ['startup', 'runtime-global', 'runtime-per-user']) as SettingScope[])
   for (const [name, entry] of Object.entries(draft[scope] ?? {}))
    if (JSON.stringify(entry) !== JSON.stringify(saved[scope]?.[name])) changes[scope][name] = entry;
  return changes;
 }
 const modChanges = $derived(changedModSettings(modDraft, modSaved, data.status.running));
 const modDirty = $derived(Object.values(modChanges).some((settings) => Object.keys(settings).length > 0));
 const settingScopes: SettingScope[] = ['startup', 'runtime-global', 'runtime-per-user'];
 let modCatalog = $state<ModSettingsCatalog>({ mods: [], unavailable: [] });
 let catalogLoading = $state(false);
 let catalogFailed = $state(false);
 let catalogLoadedKey = $state('');
 let catalogAttempt = $state(0);
 let catalogLoadedAttempt = -1;
 let modSearch = $state('');
 let selectedModTab = $state('');
 const catalogKey = $derived(JSON.stringify([data.server.id, data.status.running, data.status.version, data.mods]));
 const modTabNames = $derived(modCatalog.mods.map((mod) => mod.name));
 const modDefs = $derived(Object.fromEntries(modCatalog.mods.map((mod) => [mod.name, mod.defs])));
 const modQuery = $derived(modSearch.trim().toLowerCase());
 function matchesMod(mod: ModSettingsCatalog['mods'][number], query: string) {
  return `${mod.title ?? ''} ${mod.name}`.toLowerCase().includes(query);
 }
 function matchesSetting(def: SettingDef, query: string) {
  return `${def.label ?? ''} ${def.description ?? ''} ${def.name} ${def.name.replaceAll(/[-_]/gu, ' ')}`.toLowerCase().includes(query);
 }
 const filteredMods = $derived(modCatalog.mods.filter((mod) => matchesMod(mod, modQuery) || mod.defs.some((def) => matchesSetting(def, modQuery))));
 const selectedSettingsMod = $derived(filteredMods.find((mod) => mod.name === selectedModTab));
 const visibleModDefs = $derived((selectedSettingsMod?.defs ?? []).filter((def) => !modQuery || (selectedSettingsMod && matchesMod(selectedSettingsMod, modQuery)) || matchesSetting(def, modQuery)));
 const modChangeCount = $derived(Object.values(modChanges).reduce((total, values) => total + Object.keys(values).length, 0));
 function formatModDefault(def: SettingDef) {
  const value = def.default;
  if (value === null) return 'Default unavailable';
  if (typeof value === 'boolean') return `Default: ${value ? 'On' : 'Off'}`;
  if (typeof value === 'object') return 'Default color';
  return `Default: ${def.allowedLabels?.[String(value)] ?? (value === '' ? 'Empty' : String(value))}`;
 }
 function canEditModSetting(def: SettingDef) {
  return !data.status.running || def.settingType === 'runtime-global';
 }
 function modSettingScopeLabel(scope: SettingScope) {
  return scope === 'startup' ? 'Startup' : scope === 'runtime-global' ? 'Runtime' : 'Player defaults';
 }
 function modSettingScopeDescription(scope: SettingScope) {
  if (scope === 'startup') return data.status.running ? 'Stop the server to change startup settings.' : 'Applies after restart.';
  if (scope === 'runtime-global') return data.status.running ? 'Changes apply to this save now.' : 'Defaults for new saves.';
  return data.status.running ? 'Read only. Existing player preferences are managed in game.' : 'Defaults for new saves.';
 }
 async function navigateSettingsMods(event: KeyboardEvent) {
  const index = filteredMods.findIndex((mod) => mod.name === selectedModTab);
  let next = index;
  if (event.key === 'ArrowDown') next = Math.min(index + 1, filteredMods.length - 1);
  else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = filteredMods.length - 1;
  else return;
  event.preventDefault();
  const mod = filteredMods[next];
  if (!mod) return;
  selectedModTab = mod.name;
  await tick();
  document.getElementById(`mod-settings-nav-${mod.name}`)?.focus();
 }
 $effect(() => {
  const key = catalogKey;
  const attempt = catalogAttempt;
  if (!settingsActive || untrack(() => catalogLoadedKey === key && catalogLoadedAttempt === attempt)) return;
  const controller = new AbortController();
  catalogLoading = true;
  catalogFailed = false;
  void (async () => {
   try {
    const response = await fetch(`${base}/mod-settings-defs`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
    if (!response.ok) throw new Error('Settings unavailable');
    const catalog: ModSettingsCatalog = await response.json();
    if (controller.signal.aborted) return;
    modCatalog = catalog;
    catalogLoadedKey = key;
    catalogLoadedAttempt = attempt;
   } catch {
    if (!controller.signal.aborted) catalogFailed = true;
   } finally {
    if (!controller.signal.aborted) catalogLoading = false;
   }
  })();
  return () => controller.abort();
 });
 $effect(() => {
  const mods = filteredMods;
  if (mods.length && !mods.some((mod) => mod.name === selectedModTab)) selectedModTab = mods[0]?.name ?? '';
 });
 $effect(() => {
  const name = selectedModTab;
  void filteredMods;
  void tick().then(() => {
   const tab = document.getElementById(`mod-settings-nav-${name}`);
   const list = tab?.parentElement;
   if (!tab || !list?.clientHeight) return;
   const item = tab.getBoundingClientRect();
   const pane = list.getBoundingClientRect();
   if (item.top < pane.top) list.scrollTop += item.top - pane.top;
   else if (item.bottom > pane.bottom) list.scrollTop += item.bottom - pane.bottom;
  });
 });
 function resetModToDefaults(mod: string) {
  const next: ModDraft = {
   startup: { ...modDraft.startup },
   'runtime-global': { ...modDraft['runtime-global'] },
   'runtime-per-user': { ...modDraft['runtime-per-user'] }
  };
  for (const def of modDefs[mod] ?? [])
   if (canEditModSetting(def) && def.default !== null) next[def.settingType][def.name] = { value: def.default };
  modDraft = next;
 }
 function resetModDraft() {
  if (!data.modSettings) return;
  const saved: ModDraft = JSON.parse(data.modSettings);
  modDraft = saved;
  modSaved = saved;
  modLoaded = true;
  modMode = data.status.running;
  if (!selectedModTab || !modTabNames.includes(selectedModTab)) selectedModTab = modTabNames[0] ?? '';
 }
 $effect(() => {
  const running = data.status.running;
  if (settingsActive && data.modSettings && untrack(() => !modLoaded || modMode !== running || !modDirty)) resetModDraft();
 });
 function setModValue(def: SettingDef, next: unknown) {
  if (!canEditModSetting(def)) return;
  if (def.kind === 'color') {
   if (!next || typeof next !== 'object' || !('r' in next) || !('g' in next) || !('b' in next)) return;
   if (![next.r, next.g, next.b, 'a' in next ? next.a : 1].every((channel) => typeof channel === 'number' && Number.isFinite(channel))) return;
  } else if (typeof next !== def.kind || (typeof next === 'number' && (!Number.isFinite(next) || (def.type === 'int-setting' && !Number.isInteger(next))))) return;
  const value = next as ModValue;
  const scope = def.settingType;
  modDraft = { ...modDraft, [scope]: { ...modDraft[scope], [def.name]: { value } } };
 }
 let pending = $state(false);
 let pendingOperation = $state('');
 let pendingVersion = $state('');
 const task = $derived(activityState.items.find((item) => item.scope === 'server' && item.targetId === data.server.id && item.state === 'running'));
 const busyReason = $derived(pending ? 'Updating server' : task?.message || '');


	let confirmation = $state<{ form: HTMLFormElement; label: string } | null>(null);
	let approved: HTMLFormElement | null = null;
	const submit: import('@sveltejs/kit').SubmitFunction = ({ cancel, formElement, formData }) => {
		if (pending) { cancel(); return; }
		const operation = String(formData.get('operation'));
		if (['deleteSave', 'uninstallVersion', 'deleteMod'].includes(operation) && approved !== formElement) {
			cancel(); confirmation = { form: formElement, label: String(formData.get('name') || `Factorio ${formData.get('version')}`) }; return;
		}
		approved = null; pending = true; pendingOperation = operation; pendingVersion = String(formData.get('version') || '');
		return async ({ update, result }) => {
			try { if (result.type === 'error') { toast.error(result.error.message || 'Could not update server'); return; } await update({ reset: ['setFactorioAccount', 'uploadSave'].includes(operation), invalidateAll: false }); if (result.type === 'success') { if (operation === 'saveSettingsForm') settingsBaseline = JSON.stringify(settingsDraft); if (operation === 'saveModSettings') modSaved = modDraft; await refresh(); } } finally { pending = false; pendingOperation = ''; pendingVersion = ''; }
		};

	};
	let advancedModsOpen = $state(false);
	let currentJob = $state<typeof data.modSyncJob>(null);
	let syncMessage = $state('');
	let startingSync = $state(false);
	let showSyncReview = $state(false);
	const selectedList = $derived(data.modLists.find((list) => list.id === data.selectedListId));
	const matchingVersion = $derived(Object.entries(data.versions?.installed ?? {}).flatMap(([branch, versions]) => versions.map(version => ({ branch, version }))).filter(item => item.version.startsWith(`${selectedList?.factorioVersion}.`)).sort((a, b) => compareVersions(b.version, a.version) ?? 0)[0]);
	const reviewListId = $derived(data.activeTab === 'mods' ? selectedList?.id : undefined);
	const listRepair = $derived(activityState.items.find((item) => item.scope === 'modlist' && item.targetId === reviewListId && !item.task));
	let startingRepair = $state(false);
	let repairError = $state('');
	let repairAttempt = $state(0);
	const repairingList = $derived(startingRepair || listRepair?.state === 'running');
	$effect(() => {
		const id = reviewListId;
		void repairAttempt;
		repairError = ''; startingRepair = false;
		if (!id) return;
		const controller = new AbortController();
		startingRepair = true;
		void fetch(`/api/modlists/${encodeURIComponent(id)}/repair`, { method: 'POST', signal: controller.signal })
			.then((response) => { if (!response.ok) throw new Error('Could not check the list.'); })
			.catch(() => { if (!controller.signal.aborted) repairError = 'Could not check dependencies. Retry before applying this list.'; })
			.finally(() => { if (!controller.signal.aborted) startingRepair = false; });
		return () => controller.abort();
	});
	const manageAction = $derived(`?/manage&tab=${data.activeTab}${data.selectedListId ? `&list=${encodeURIComponent(data.selectedListId)}` : ''}`);

	$effect(() => {
		currentJob = loadedJob;
	});


	$effect(() => {
		if (currentJob?.status !== 'running') return;
        const controller = new AbortController();
        let checking = false;
		const timer = setInterval(async () => {
            if (checking) return;
            checking = true;
			try {
				const response = await fetch(`${base}/mod-sync`, { signal: controller.signal });
				if (!response.ok) throw new Error('Could not get update status');
				const result = (await response.json()) as { job: typeof currentJob };
				currentJob = result.job;
				if (result.job?.status !== 'running') await refresh();
			} catch {
				if (!controller.signal.aborted) syncMessage = 'Could not check update progress. Refresh this page to retry.';
			} finally { checking = false; }
		}, 1000);
		return () => { controller.abort(); clearInterval(timer); };
	});

	async function applyModList() {
		if (!data.selectedListId || !data.selectedPlan || startingSync) return;
		startingSync = true;
		syncMessage = '';
		try {
			const response = await fetch(`${base}/mod-sync`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ listId: data.selectedListId, hash: data.selectedPlan.hash })
			});
			const result = (await response.json()) as { job?: typeof currentJob; error?: string };
			if (!response.ok || !result.job) {
				syncMessage = result.error ?? 'Could not start the update';
			} else {
				currentJob = result.job;
				showSyncReview = false;
			}
		} catch {
			syncMessage = 'Could not start the update';
		} finally {
			startingSync = false;
		}
	}

	const inputClass =
		'border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
</script>

<div class={`flex min-h-0 flex-col gap-4 ${data.activeTab === 'console' ? 'flex-1' : ''}`}>

	{#if data.unavailable.length}
		<p role="alert" class="rounded-md border border-yellow-500 p-3 text-sm">
			Could not load: {data.unavailable.join(', ')}.
		</p>
	{/if}

	{#if data.activeTab === 'mods'}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center justify-between gap-2">Apply a mod list{#if repairingList}<span role="status" aria-label="Checking mods"><LoaderCircleIcon class="size-4 animate-spin" /></span>{/if}</Card.Title>

			</Card.Header>
			<Card.Content class="space-y-5">
				<form method="GET" action={base} onsubmit={(event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); const query = new URLSearchParams(); for (const [key, value] of fields) if (typeof value === 'string') query.set(key, value); void goto(`${base}?${query}`); }} class="flex flex-wrap items-end gap-3">
					<input type="hidden" name="tab" value="mods" />
					<label class="min-w-64 flex-1 text-sm font-medium">Mod list
						<select name="list" class={`${inputClass} mt-1`} value={data.selectedListId ?? ''} onchange={(event) => event.currentTarget.form?.requestSubmit()}>
							<option value="">Choose a list</option>
							{#each data.modLists as list (list.id)}<option value={list.id}>{list.name}</option>{/each}
						</select>
					</label>
					{#if selectedList}<a href={`/modlists/${selectedList.id}`} class="text-primary py-2 text-sm underline">Edit {selectedList.name}</a>{/if}
				</form>
    {#if selectedList && !data.status.version.version.startsWith(`${selectedList.factorioVersion}.`)}
     <div class="flex flex-wrap items-center justify-between gap-3 border border-primary/40 p-3 text-sm">
      <span>{selectedList.name} requires Factorio {selectedList.factorioVersion}.</span>
      {#if matchingVersion}
       <form method="POST" action={manageAction} use:enhance={submit}><input type="hidden" name="operation" value="selectVersion" /><input type="hidden" name="branch" value={matchingVersion.branch} /><input type="hidden" name="version" value={matchingVersion.version} /><TooltipButton type="submit" size="sm" tooltip={busyReason || (data.status.running ? 'Stop the server first' : `Use Factorio ${matchingVersion.version}`)} disabled={pending || serverBusy || data.status.running}>{#if pendingOperation === 'selectVersion'}<LoaderCircleIcon class="size-4 animate-spin" />{:else}<CheckIcon class="size-4" />{/if}Use {matchingVersion.version}</TooltipButton></form>
      {:else}<Button href={`${base}?tab=settings`} variant="outline" size="sm"><DownloadIcon class="size-4" />Install Factorio {selectedList.factorioVersion}</Button>{/if}
     </div>
    {/if}
				{#if repairError}<div role="alert" class="flex flex-wrap items-center gap-3 text-sm text-amber-500"><p>{repairError}</p><Button variant="outline" size="sm" onclick={() => repairAttempt++}><RefreshCwIcon class="size-4" />Retry repair</Button></div>{/if}
				{#if data.selectedListId && !data.selectedPlan}<p role="alert" class="text-destructive text-sm">{data.unavailable.includes('mods') || data.unavailable.includes('mod list review') ? 'Could not read the server inventory for this review. Retry when the server connection is available.' : 'This list is unavailable. Choose a list shared with you.'}</p>{/if}
				{#if data.selectedPlan}
					<div class="grid gap-3 sm:grid-cols-3">
						<div class="bg-muted rounded-md p-3"><strong>{data.selectedPlan.desiredCount}</strong><span class="text-muted-foreground ml-2 text-sm">enabled in list</span></div>
						<div class="bg-muted rounded-md p-3"><strong>{data.selectedPlan.serverCount}</strong><span class="text-muted-foreground ml-2 text-sm">enabled on server</span></div>
						<div class="bg-muted rounded-md p-3"><strong>{data.selectedPlan.changes.length}</strong><span class="text-muted-foreground ml-2 text-sm">changes</span></div>
					</div>
					{#if data.selectedPlan.problems.length}
						<div role="alert" class="border-destructive/50 bg-destructive/10 rounded-md border p-4 text-sm">
							<strong>Resolve these list issues before applying</strong>
							<ul class="mt-2 max-h-40 list-inside list-disc overflow-auto">{#each data.selectedPlan.problems as problem}<li>{problem}</li>{/each}</ul>
						</div>
					{/if}
					{#if currentJob?.status === 'running'}
						<p role="status" class="text-sm">Updating mods: {currentJob.completed} of {currentJob.total} complete · {currentJob.current}</p>
					{:else if currentJob?.status === 'failed' && currentJob.listId === data.selectedListId}
						<p role="alert" class="text-destructive text-sm">{currentJob.error} ({currentJob.completed} of {currentJob.total} completed). Review the remaining changes before retrying.</p>
					{/if}
					{#if syncMessage}<p role="alert" class="text-destructive text-sm">{syncMessage}</p>{/if}
					{#if data.selectedPlan.changes.length}
						<Button type="button" variant="outline" onclick={() => (showSyncReview = !showSyncReview)}><ListChecksIcon class="size-4" />{showSyncReview ? 'Hide review' : `Review ${data.selectedPlan.changes.length} changes`}</Button>
						{#if showSyncReview}
							<div class="border-border rounded-md border p-4">
								<ul class="max-h-64 space-y-1 overflow-auto text-sm">
									{#each data.selectedPlan.changes as change}<li><span class="inline-block w-16 capitalize">{change.kind}</span><strong>{change.name}</strong>{change.kind === 'install' ? ` · ${change.previous.length ? `${change.previous.join(', ')} → ` : ''}${change.version}` : ''}</li>{/each}
								</ul>
								<p class="text-muted-foreground mt-3 text-xs">Mods outside this list are disabled; installed files remain on disk. Each enabled mod will use the version selected in the list. Previous archives are kept in the server’s download cache. The server must be stopped while applying changes.</p>
								<TooltipButton type="button" class="mt-4" disabled={repairingList || !!repairError || data.status.running || !!data.selectedPlan.problems.length || startingSync || currentJob?.status === 'running'} onclick={applyModList} tooltip={repairingList ? 'Checking mods' : repairError || (data.selectedPlan?.problems.length ? 'Resolve the list issues first' : '') || busyReason || (data.status.running ? 'Stop the server first' : '') || 'Apply changes'}><CheckIcon class="size-4" />Apply {data.selectedPlan.changes.length} changes</TooltipButton>
							</div>
						{/if}
					{:else if !data.selectedPlan.problems.length}<p class="text-muted-foreground text-sm">This server already matches the list.</p>{#if data.server.selectedModlist !== data.selectedListId}<TooltipButton type="button" disabled={repairingList || !!repairError || startingSync || data.status.running || currentJob?.status === 'running'} onclick={applyModList} tooltip={repairingList ? 'Checking mods' : repairError || (data.selectedPlan?.problems.length ? 'Resolve the list issues first' : '') || busyReason || (data.status.running ? 'Stop the server first' : '') || 'Use this list'}><CheckIcon class="size-4" />Use this list</TooltipButton>{/if}{/if}
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

 {#if data.activeTab === 'saves'}
  <ServerSaves serverId={data.server.id} saves={data.saves} selected={data.selectedSave} resumeAutosave={data.resumeAutosave} running={data.status.running} configured={data.status.is_configured} {busyReason} creating={task?.task === 'save-create'} action={manageAction} {base} {submit} />
 {/if}

	{#if data.activeTab === 'mods'}
	<details class="space-y-4" ontoggle={(event) => (advancedModsOpen = event.currentTarget.open)}>
		<summary class="text-muted-foreground hover:text-foreground cursor-pointer text-sm">Installed mods and bookmarks</summary>
		{#if advancedModsOpen}
		<Card.Root>
			<Card.Header>
				<Card.Title>Installed mods</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<form method="POST" action={manageAction} use:enhance={submit} class="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
					<input type="hidden" name="operation" value="downloadMod" />
					<input name="name" class={inputClass} placeholder="Mod name" required aria-label="Mod name" />
					<input name="version" class={inputClass} placeholder="1.2.3" required aria-label="Mod version" />
					<TooltipButton type="submit" disabled={pending || serverBusy} tooltip={busyReason || 'Download'}><DownloadIcon class="size-4" />Download</TooltipButton>
				</form>
				<ul class="divide-border divide-y">
					{#each data.mods as mod (mod.name)}
						<li class="flex items-center justify-between gap-3 py-2 text-sm">
							<span class="truncate">{mod.name}</span>
							<form method="POST" action={manageAction} use:enhance={submit}>
								<input type="hidden" name="operation" value="toggleMod" />
								<input type="hidden" name="name" value={mod.name} />
								<input type="hidden" name="enabled" value={String(!mod.enabled)} />
								<TooltipButton type="submit" size="sm" variant="outline" disabled={pending || data.status.running || serverBusy || mod.name === 'base'} tooltip={busyReason || (data.status.running ? 'Stop the server first' : '') || (mod.name === 'base' ? 'Base is required' : '') || 'Apply changes'}>{#if mod.enabled}<CircleStopIcon class="size-4" />{:else}<CirclePlayIcon class="size-4" />{/if}{mod.enabled ? 'Disable' : 'Enable'}</TooltipButton>
							</form>
						</li>
					{/each}
				</ul>
				<form method="POST" action={manageAction} use:enhance={submit} class="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
					<input name="name" class={inputClass} placeholder="Mod name" required aria-label="Installed mod name" />
					<input name="version" class={inputClass} placeholder="1.2.3" required aria-label="Installed mod version" />
					<select name="operation" class={inputClass} aria-label="Mod file action">
						<option value="installMod">Install</option>
						<option value="uninstallMod">Uninstall</option>
						<option value="deleteMod">Delete download</option>
					</select>
					<TooltipButton type="submit" variant="outline" disabled={pending || data.status.running || serverBusy} tooltip={busyReason || (data.status.running ? 'Stop the server first' : '') || 'Apply'}><CheckIcon class="size-4" />Apply</TooltipButton>
				</form>
			</Card.Content>
		</Card.Root>
	<ServerBookmarks {base} factorioVersion={data.status.version.version.split('.').slice(0, 2).join('.')} running={data.status.running} busy={pending || serverBusy} action={manageAction} {submit} revision={loadedMods} />
		{/if}
	</details>
	{/if}

	{#if data.activeTab === 'settings'}
	<div class="grid gap-6 lg:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>Server versions</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#if data.versions}
					{#each Object.entries(data.versions.installed) as [branch, versions] (branch)}
						{#each versions as version (`${branch}/${version}`)}
							<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
								<span>{version} ({branch}){data.status.version.branch === branch && data.status.version.version === version ? ' · selected' : ''}</span>
								<div class="flex gap-2">
									{#if data.status.version.branch !== branch || data.status.version.version !== version}
										<form method="POST" action={manageAction} use:enhance={submit}>
											<input type="hidden" name="operation" value="selectVersion" />
											<input type="hidden" name="branch" value={branch} />
											<input type="hidden" name="version" value={version} />
											<TooltipButton type="submit" size="sm" variant="outline" disabled={pending || serverBusy || data.status.running} tooltip={busyReason || (data.status.running ? 'Stop the server first' : '') || 'Select'}>{#if pendingOperation === 'selectVersion' && pendingVersion === version}<LoaderCircleIcon class="size-4 animate-spin" />{:else}<CheckIcon class="size-4" />{/if}Select</TooltipButton>
										</form>
										<form method="POST" action={manageAction} use:enhance={submit}>
											<input type="hidden" name="operation" value="uninstallVersion" />
											<input type="hidden" name="branch" value={branch} />
											<input type="hidden" name="version" value={version} />
											<TooltipButton type="submit" size="sm" variant="destructive" disabled={pending || serverBusy || data.status.running} tooltip={busyReason || (data.status.running ? 'Stop the server first' : '') || 'Remove'}>{#if pendingOperation === 'uninstallVersion' && pendingVersion === version}<LoaderCircleIcon class="size-4 animate-spin" />{:else}<TrashIcon class="size-4" />{/if}Remove</TooltipButton>
										</form>
									{/if}
								</div>
							</div>
						{/each}
					{/each}

				{/if}
    <details bind:open={releasesOpen} class="text-sm"><summary class="cursor-pointer">Download another version{#if releasesLoading}<span role="status" aria-label="Checking releases" class="ml-2 inline-flex align-middle"><LoaderCircleIcon class="size-4 motion-safe:animate-spin" /></span>{/if}</summary>
     <div class="mt-3 space-y-3">
					{#each ['stable', 'experimental'] as branch}
						{@const version = availableVersions[branch]?.headless}
						{#if version && !data.versions?.installed[branch]?.includes(version)}
							<form method="POST" action={manageAction} use:enhance={submit} class="flex items-center justify-between gap-2 text-sm">
								<input type="hidden" name="operation" value="downloadVersion" />
								<input type="hidden" name="branch" value={branch} />
								<input type="hidden" name="version" value={version} />
								<span>{version} ({branch}, available)</span>
								<TooltipButton type="submit" size="sm" disabled={pending || serverBusy} tooltip={busyReason || 'Download'}>{#if task?.task === 'version-download' && task.message.includes(version)}<LoaderCircleIcon class="size-4 animate-spin" />{task.completed}%{:else}<DownloadIcon class="size-4" />Download{/if}</TooltipButton>
							</form>
						{/if}
					{/each}
    {#if releasesWarning}<p role="status" class="text-muted-foreground text-sm">{releasesWarning} <button type="button" class="inline-flex items-center gap-1 underline" disabled={releasesLoading} onclick={() => releaseAttempt += 1}><RefreshCwIcon class="size-4" />Retry</button></p>{/if}
     </div>
     <form method="POST" action={manageAction} use:enhance={submit} class="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="operation" value="downloadVersion" />
      <label class="flex-1">Version<input name="version" placeholder="2.0.72" pattern="[0-9]+\.[0-9]+\.[0-9]+" required class={`${inputClass} mt-1`} /></label>
      <label>Branch<select name="branch" class={`${inputClass} mt-1`}><option value="stable">Stable</option><option value="experimental">Experimental</option></select></label>
      <TooltipButton type="submit" disabled={pending || serverBusy} tooltip={busyReason || 'Download'}><DownloadIcon class="size-4" />Download</TooltipButton>
     </form>
    </details>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Factorio service token</Card.Title>
				<Card.Description>Used for mod downloads and bookmarks.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				<p class="text-sm">Username: {data.factorioUser?.username || 'Not configured'} · {data.factorioUser?.hasToken ? 'Token configured' : 'No token'}</p>
				<form method="POST" action={manageAction} use:enhance={submit}>
					<input type="hidden" name="operation" value="syncFactorioAccount" />
					<TooltipButton type="submit" disabled={pending || serverBusy || !data.canSyncFactorioAccount} tooltip={busyReason || (!data.canSyncFactorioAccount ? 'Add your service token in account settings' : '') || 'Use my service token'}><RefreshCwIcon class="size-4" />Use my service token</TooltipButton>
				</form>
				{#if !data.canSyncFactorioAccount}<p class="text-muted-foreground mt-2 text-sm">Add a service token in <a href="/settings" class="underline">Settings</a> first.</p>{/if}
				<form method="POST" action={manageAction} use:enhance={submit} class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
					<input type="hidden" name="operation" value="setFactorioAccount" />
					<input name="username" class={inputClass} placeholder="Factorio username" aria-label="Factorio username" required />
					<input name="token" type="password" autocomplete="new-password" class={inputClass} placeholder="Service token" aria-label="Factorio service token" required />
					<TooltipButton type="submit" disabled={pending || serverBusy} variant="outline" tooltip={busyReason || 'Save token'}><LinkIcon class="size-4" />Save token</TooltipButton>
				</form>
			</Card.Content>
		</Card.Root>
	</div>

 {#if data.gameAssistant}{#key JSON.stringify(data.gameAssistant)}<GameAssistantSettings config={data.gameAssistant} models={data.gameModels} action={manageAction} {submit} {busyReason} />{/key}{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Server settings</Card.Title>
		<Card.Description>Settings take effect when the server restarts.</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if data.settings}
				<form method="POST" action={manageAction} use:enhance={submit} class="space-y-2">
					<input type="hidden" name="operation" value="saveSettingsForm" />
					{#each data.settingFields as field (field.key)}
						<div class="grid gap-2 md:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] md:items-center">
							<div class="flex items-center gap-1"><label for={`setting-${field.key}`} class="text-sm font-medium capitalize">{field.key.replaceAll('_', ' ')}</label>{#if field.description}<SettingHelp label={field.key.replaceAll('_', ' ')} description={field.description} serverId={data.server.id} />{/if}</div>
<input type="hidden" name={`setting:${field.key}`} value={field.kind === 'json' ? JSON.stringify(settingsDraft[field.key]) : String(settingsDraft[field.key])} />
       <SettingInput id={`setting-${field.key}`} bind:value={settingsDraft[field.key]} />
						</div>
					{/each}
					<div class="flex items-center gap-2 pt-2"><TooltipButton tooltip={pending || serverBusy ? 'Updating server' : !settingsDirty ? 'No changes' : 'Save settings'} type="submit" disabled={pending || serverBusy || !settingsDirty}><SaveIcon class="size-4" />Save settings</TooltipButton>{#if settingsDirty}<Button variant="ghost" onclick={() => { settingsDraft = JSON.parse(data.settings || '{}'); settingsBaseline = JSON.stringify(settingsDraft); }}><XIcon class="size-4" />Discard</Button>{/if}</div>
				</form>
			{:else}
				<p class="text-muted-foreground text-sm">Server settings are unavailable until the server is configured.</p>
			{/if}
		</Card.Content>
	</Card.Root>

 <Card.Root>
  <Card.Header><Card.Title>Mod settings</Card.Title></Card.Header>
  <Card.Content>
   {#if data.modSettings}
    <form method="POST" action={manageAction} use:enhance={submit} class="space-y-3">
     <input type="hidden" name="operation" value="saveModSettings" />
     <input type="hidden" name="modSettings" value={JSON.stringify(modChanges)} />
     <div class="overflow-hidden border bg-background/20 md:grid md:h-[min(40rem,70dvh)] md:min-h-80 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col border-b bg-background/30 md:border-r md:border-b-0">
       <div class="space-y-2 border-b p-3">
        <div class="relative">
         <SearchIcon class="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
         <input type="search" aria-label="Search mod settings" placeholder="Find a mod or setting…" bind:value={modSearch} onkeydown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} class="w-full min-w-0 border border-input bg-background py-2 pr-8 pl-8 text-sm" />
        </div>
        <p class="text-xs text-muted-foreground" aria-live="polite">{catalogLoading ? 'Reading mod settings…' : `${filteredMods.length}${modQuery ? ` of ${modCatalog.mods.length}` : ''} mods with settings`}</p>
        <select aria-label="Choose a mod" bind:value={selectedModTab} disabled={catalogLoading || !filteredMods.length} class="w-full min-w-0 border border-input bg-background px-2 py-2 text-sm md:hidden">
         {#each filteredMods as mod (mod.name)}<option value={mod.name}>{mod.title || mod.name}</option>{/each}
        </select>
       </div>
       {#if catalogLoading}
        <div class="hidden space-y-3 p-3 md:block" aria-hidden="true">{#each [1, 2, 3, 4, 5, 6] as row (row)}<div class="flex h-11 items-center gap-3"><span class="size-8 animate-pulse bg-muted"></span><span class="h-3 w-36 animate-pulse bg-muted"></span></div>{/each}</div>
       {:else}
        <div role="tablist" tabindex="-1" aria-label="Mods with settings" aria-orientation="vertical" onkeydown={navigateSettingsMods} class="hidden min-h-0 flex-1 overflow-y-auto p-1 md:block">
         {#each filteredMods as mod (mod.name)}
          {@const dirty = mod.defs.some((def) => modChanges[def.settingType][def.name])}
          <button id={`mod-settings-nav-${mod.name}`} type="button" role="tab" aria-controls="mod-settings-panel" aria-selected={selectedModTab === mod.name} tabindex={selectedModTab === mod.name ? 0 : -1} onclick={() => { selectedModTab = mod.name; }} class={`flex w-full items-center gap-2.5 border-l-2 px-2.5 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedModTab === mod.name ? 'border-primary bg-primary/10 text-primary' : 'border-transparent hover:bg-muted/70'}`}>
           <span class="flex size-8 shrink-0 items-center justify-center bg-background/40">{#if mod.thumbnail}<img src={modThumbnailUrl(mod.thumbnail)} alt="" loading="lazy" class="size-full object-contain" />{:else}<PackageIcon class="size-5 text-muted-foreground" />{/if}</span>
           <span class="min-w-0 flex-1 break-words font-medium">{mod.title || mod.name}</span>
           {#if dirty}<span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span><span class="sr-only">Unsaved changes</span>{/if}
          </button>
         {/each}
        </div>
       {/if}
      </aside>
      <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: A tab panel is a keyboard focus destination. -->
      <div id="mod-settings-panel" tabindex="0" role="tabpanel" aria-labelledby={selectedSettingsMod ? 'mod-settings-title' : undefined} aria-label={selectedSettingsMod ? undefined : 'Mod settings'} class="flex min-h-0 min-w-0 flex-col focus-visible:outline focus-visible:outline-ring">
       {#if catalogLoading}
        <div class="min-h-72 space-y-7 p-5" role="status"><span class="sr-only">Reading mod settings</span><div class="h-5 w-48 animate-pulse bg-muted" aria-hidden="true"></div>{#each [1, 2, 3, 4] as row (row)}<div class="grid gap-3 sm:grid-cols-2" aria-hidden="true"><div class="h-4 w-40 animate-pulse bg-muted"></div><div class="h-8 animate-pulse bg-muted"></div></div>{/each}</div>
       {:else if catalogFailed}
        <div class="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 p-6"><p role="alert" class="text-sm text-destructive">Could not read mod settings.</p><Button variant="outline" size="sm" onclick={() => { catalogAttempt += 1; }}>Retry</Button></div>
       {:else if selectedSettingsMod}
        <header class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
         <div class="flex min-w-0 items-center gap-3">
          {#if selectedSettingsMod.thumbnail}<img src={modThumbnailUrl(selectedSettingsMod.thumbnail)} alt="" class="size-10 shrink-0 object-contain" />{:else}<PackageIcon class="size-8 shrink-0 text-muted-foreground" />{/if}
          <div class="min-w-0"><h3 id="mod-settings-title" class="break-words text-base">{selectedSettingsMod.title || selectedSettingsMod.name}</h3><p class="text-xs text-muted-foreground">v{selectedSettingsMod.version} · {visibleModDefs.length}{visibleModDefs.length !== selectedSettingsMod.defs.length ? ` of ${selectedSettingsMod.defs.length}` : ''} settings</p></div>
         </div>
         {#if selectedSettingsMod.defs.some((def) => canEditModSetting(def) && def.default !== null)}<Button variant="ghost" size="sm" aria-label={`Reset ${selectedSettingsMod.title || selectedSettingsMod.name} to defaults`} disabled={pending || serverBusy} onclick={() => resetModToDefaults(selectedSettingsMod.name)}><RefreshCwIcon class="size-3.5" />Reset defaults</Button>{/if}
        </header>
        <div class="max-h-[65dvh] min-h-60 flex-1 space-y-6 overflow-y-auto p-4 md:max-h-none">
         {#each settingScopes as scope (scope)}
          {@const defs = visibleModDefs.filter((def) => def.settingType === scope)}
          {#if defs.length}
           <section aria-labelledby={`mod-scope-${scope}`} class="space-y-3">
            <div class="border-b pb-2"><h4 id={`mod-scope-${scope}`} class="text-sm">{modSettingScopeLabel(scope)}</h4><p class="text-xs text-muted-foreground">{modSettingScopeDescription(scope)}</p></div>
            {#each defs as def (`${def.settingType}:${def.name}`)}
             {@const saved = modDraft[def.settingType]?.[def.name]}
             {@const value = saved?.value ?? def.default}
             <div class="grid gap-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(0,1fr)] lg:items-center">
              <div class="min-w-0">
               <div class="flex items-start gap-1.5"><span id={`modsetting-label-${selectedModTab}-${def.name}`} class="min-w-0 break-words text-sm font-medium"><FactorioRichText text={def.label || def.name.replaceAll(/[-_]/gu, ' ')} serverId={data.server.id} /></span>{#if def.description}<SettingHelp label={def.label || def.name.replaceAll(/[-_]/gu, ' ')} description={def.description} serverId={data.server.id} />{/if}</div>
               <p class="break-words text-xs text-muted-foreground">{formatModDefault(def)}</p>
              </div>
              {#if value !== null}<SettingInput id={`modsetting-${selectedModTab}-${def.name}`} labelledBy={`modsetting-label-${selectedModTab}-${def.name}`} {value} min={def.minimum} max={def.maximum} allowed={def.allowed} allowedLabels={def.allowedLabels} label={def.label} type={def.type} disabled={pending || serverBusy || !canEditModSetting(def)} onchange={(next) => setModValue(def, next)} />{:else}<span class="text-xs text-muted-foreground">Default unavailable</span>{/if}
             </div>
            {/each}
           </section>
          {/if}
         {/each}
        </div>
       {:else}
        <div class="flex min-h-72 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{modQuery ? 'No matching mods or settings.' : 'No installed mods expose settings.'}</div>
       {/if}
      </div>
     </div>
     {#if modCatalog.unavailable.length}<details class="text-xs text-muted-foreground"><summary>{modCatalog.unavailable.length} mods could not be checked</summary><p class="py-2">{modCatalog.unavailable.join(', ')}</p><Button variant="link" size="sm" onclick={() => { catalogAttempt += 1; }}>Retry</Button></details>{/if}
     <div class="flex flex-wrap items-center gap-2">
      <TooltipButton tooltip={pending || serverBusy ? 'Updating server' : !modDirty ? 'No changes' : data.status.running ? 'Apply runtime settings' : 'Save mod settings'} type="submit" disabled={pending || serverBusy || !modDirty || catalogLoading}><SaveIcon class="size-4" />{data.status.running ? 'Apply mod settings' : 'Save mod settings'}</TooltipButton>
      {#if modDirty}<Button variant="ghost" onclick={() => resetModDraft()}><XIcon class="size-4" />Discard</Button><span class="text-xs text-muted-foreground">{modChangeCount} {modChangeCount === 1 ? 'setting' : 'settings'} changed</span>{/if}
     </div>
    </form>
   {:else}<p class="text-muted-foreground text-sm">Mod settings are unavailable until the server is configured.</p>{/if}
  </Card.Content>
 </Card.Root>
	{/if}

	{#if data.activeTab === 'access'}
	<div class="grid gap-6 lg:grid-cols-3">
		{#each [{ label: 'Admins', key: 'factorio-admins', users: data.admins }, { label: 'Bans', key: 'factorio-bans', users: data.bans }, { label: 'Whitelist', key: 'factorio-whitelist', users: data.whitelist }] as list (list.key)}
			<Card.Root>
				<Card.Header><Card.Title>{list.label}</Card.Title></Card.Header>
				<Card.Content class="space-y-3">
     {#if list.key === 'factorio-whitelist' && data.useWhitelist !== undefined}
      <form method="POST" action={manageAction} use:enhance={submit} class="space-y-2">
       <input type="hidden" name="operation" value="setWhitelist" />
       <input type="hidden" name="enabled" value={String(!data.useWhitelist)} />
       <p class="text-sm">{data.useWhitelist ? 'Only whitelisted players can join.' : 'The whitelist is not enforced.'}</p>
       <TooltipButton type="submit" variant="outline" size="sm" disabled={pending || serverBusy} tooltip={busyReason || 'Apply changes'}><ShieldCheckIcon class="size-4" />{data.useWhitelist ? 'Disable whitelist' : 'Enable whitelist'}</TooltipButton>
       <p class="text-muted-foreground text-xs">Takes effect after the server restarts.</p>
      </form>
     {/if}
					<form method="POST" action={manageAction} use:enhance={submit} class="flex gap-2">
						<input type="hidden" name="operation" value="addUser" />
						<input type="hidden" name="list" value={list.key} />
						<input name="username" class={inputClass} placeholder="Factorio username" required aria-label={`Add ${list.label.toLowerCase()} user`} />
						<TooltipButton type="submit" disabled={pending || serverBusy} size="sm" tooltip={busyReason || 'Add'}><PlusIcon class="size-4" />Add</TooltipButton>
					</form>
					<ul class="space-y-1">
						{#each list.users as username (username)}
							<li class="flex items-center justify-between gap-2 text-sm">
								<span>{username}</span>
								<form method="POST" action={manageAction} use:enhance={submit}>
									<input type="hidden" name="operation" value="removeUser" />
									<input type="hidden" name="list" value={list.key} />
									<input type="hidden" name="username" value={username} />
									<button type="submit" disabled={pending || serverBusy} class="text-destructive inline-flex items-center gap-1 underline disabled:opacity-50"><TrashIcon class="size-4" />Remove</button>
								</form>
							</li>
						{/each}
					</ul>
				</Card.Content>
		</Card.Root>
		{/each}
	</div>

	{/if}

	{#if data.activeTab === 'console'}
		{#key data.server.id}<Console serverId={data.server.id} serverName={data.server.name} running={data.status.running} />{/key}
	{/if}
</div>

<Dialog.Root open={confirmation !== null} onOpenChange={(open) => { if (!open) confirmation = null; }}>
	<Dialog.Content><Dialog.Header><Dialog.Title>Delete {confirmation?.label}?</Dialog.Title><Dialog.Description>This removes the file from {data.server.name}. Download a backup first if you may need it again.</Dialog.Description></Dialog.Header><Dialog.Footer><Button variant="outline" onclick={() => { confirmation = null; }}><XIcon class="size-4" />Cancel</Button><Button variant="destructive" onclick={() => { const target = confirmation?.form; confirmation = null; if (target) { approved = target; target.requestSubmit(); } }}><TrashIcon class="size-4" />Delete file</Button></Dialog.Footer></Dialog.Content>
</Dialog.Root>
