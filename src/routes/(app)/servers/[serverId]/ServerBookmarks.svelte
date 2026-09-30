<script lang="ts">
	import { RefreshCwIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, PackagePlusIcon, PackageMinusIcon, TrashIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ModSummary from '$lib/components/ModSummary.svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import ModPreviewSheet from '../../modlists/[id]/ModPreviewSheet.svelte';
 import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import { compareVersions, supportsFactorio } from '$lib/dependencies';
	import type { ModInventory } from '$lib/server/server-mods';
	import type { PortalMod } from '$lib/server/portal-cache';

	let { base, factorioVersion, running, busy, action, submit, revision }: { base: string; factorioVersion: string; running: boolean; busy: boolean; action: string; submit: SubmitFunction; revision: unknown } = $props();
	type Bookmarks = ModInventory & { names: string[]; warning?: string };
	let previewOpen = $state(false);
 let previewName = $state<string | null>(null);
 let bookmarks = $state<Bookmarks | null>(null);
	let message = $state('');
	let loading = $state(false);
	let retry = $state(0);
	let query = $state('');
	let page = $state(0);
	let details = $state<Record<string, PortalMod | null>>({});
	let selectedVersions = $state<Record<string, string>>({});
	const filtered = $derived(bookmarks?.names.filter((name) => name.toLowerCase().includes(query.toLowerCase())) ?? []);
	const pages = $derived(Math.max(1, Math.ceil(filtered.length / 12)));
	const currentPage = $derived(Math.min(page, pages - 1));
	const visible = $derived(filtered.slice(currentPage * 12, (currentPage + 1) * 12));
	const inputClass = 'border-input bg-background w-full rounded-md border px-3 py-2 text-sm';
	function has(entries: Record<string, string[]>[] | null, name: string, version: string) {
		return entries?.some((entry) => entry[name]?.includes(version)) ?? false;
	}
	function versions(name: string, info: PortalMod | null | undefined) {
		return [...new Set([
			...(info?.releases.filter((release) => supportsFactorio(release.info_json.factorio_version, factorioVersion)).map((release) => release.version) ?? []),
			...(bookmarks?.installed?.flatMap((entry) => entry[name] ?? []) ?? []),
			...(bookmarks?.available?.flatMap((entry) => entry[name] ?? []) ?? [])
		])].sort((a, b) => compareVersions(b, a) ?? 0);
	}
	$effect(() => {
		void revision; void retry;
		const controller = new AbortController();
		loading = true; message = '';
		void fetch(`${base}/bookmarks`, { signal: controller.signal }).then(async (response) => {
			if (!response.ok) throw new Error('Could not load bookmarks. Check the service token in Settings.');
			const result: Bookmarks = await response.json();
			if (!controller.signal.aborted) bookmarks = result;
		}).catch((cause: unknown) => { if (!controller.signal.aborted) message = cause instanceof Error ? cause.message : 'Could not load bookmarks'; }).finally(() => { if (!controller.signal.aborted) loading = false; });
		return () => controller.abort();
	});
	$effect(() => {
		const controller = new AbortController();
		for (const name of visible) {
			void fetch(`/api/factorio-mods/${encodeURIComponent(name)}`, { signal: controller.signal }).then(async (response) => {
				const info: PortalMod | null = response.ok ? await response.json() : null;
				if (!controller.signal.aborted) details[name] = info;
			}).catch(() => { if (!controller.signal.aborted) details[name] = null; });
		}
		return () => controller.abort();
	});
</script>
<Card.Root>
	<Card.Header><Card.Title>Bookmarked mods</Card.Title></Card.Header>
	<Card.Content class="space-y-3">
		{#if loading}<p role="status" class="text-muted-foreground text-sm">Loading bookmarks…</p>{/if}
		{#if message}<div role="alert" class="flex items-center gap-3 text-sm"><span>{message}</span><Button variant="outline" size="sm" onclick={() => retry++}><RefreshCwIcon class="size-4" />Retry</Button></div>{/if}
		{#if bookmarks?.warning}<p class="text-muted-foreground text-sm">{bookmarks.warning}</p>{/if}
		{#if bookmarks?.names.length}
			<div class="flex items-center gap-3"><input class={inputClass} aria-label="Filter bookmarked mods" placeholder="Filter bookmarks…" bind:value={query} oninput={() => page = 0} /><span class="text-muted-foreground shrink-0 text-sm">{filtered.length} bookmarks</span></div>
			<ul class="divide-border divide-y">
				{#each visible as name (name)}
					{@const info = details[name]}
					{@const releases = versions(name, info)}
					{@const selected = selectedVersions[name] ?? releases[0] ?? ''}
					<li class="grid gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_8rem_auto] md:items-center">
						<ModSummary {name} title={info?.title} thumbnail={info?.thumbnail} owner={info?.owner} summary={info?.summary} preview={() => { previewName = name; previewOpen = true; }}>
        {#if has(bookmarks.installed, name, selected)}<span class="text-xs">Installed</span>{:else if has(bookmarks.available, name, selected)}<span class="text-xs">Downloaded</span>{/if}
        {#if info === undefined}<span role="status" class="text-xs text-muted-foreground">Loading…</span>{:else if info === null}<span class="text-xs text-amber-300">Could not load releases</span>{:else if !releases.length}<span class="text-xs text-muted-foreground">No Factorio {factorioVersion} release</span>{/if}
       </ModSummary>
						{#if selected}
							<select class={inputClass} aria-label={`${name} version`} value={selected} onchange={(event) => selectedVersions[name] = event.currentTarget.value}>{#each releases as version (version)}<option value={version}>{version}</option>{/each}</select>
							<div class="flex flex-wrap gap-2">
								{#each [
									{ operation: 'downloadMod', icon: DownloadIcon, label: 'Download', show: !has(bookmarks.available, name, selected) && !has(bookmarks.installed, name, selected) },
									{ operation: 'installMod', icon: PackagePlusIcon, label: 'Install', show: has(bookmarks.available, name, selected) && !has(bookmarks.installed, name, selected) },
									{ operation: 'uninstallMod', icon: PackageMinusIcon, label: 'Uninstall', show: has(bookmarks.installed, name, selected) },
									{ operation: 'deleteMod', icon: TrashIcon, label: 'Delete download', show: has(bookmarks.available, name, selected) && !has(bookmarks.installed, name, selected) }
								] as choice (choice.operation)}
									{#if choice.show}<form method="POST" {action} use:enhance={submit}><input type="hidden" name="operation" value={choice.operation} /><input type="hidden" name="name" value={name} /><input type="hidden" name="version" value={selected} /><TooltipButton tooltip={busy ? 'Updating server' : running && ['installMod', 'uninstallMod'].includes(choice.operation) ? 'Stop the server first' : choice.label} type="submit" size="sm" variant="outline" disabled={busy || (running && ['installMod', 'uninstallMod'].includes(choice.operation))}><choice.icon class="size-4" />{choice.label}</TooltipButton></form>{/if}
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="flex items-center justify-between gap-3"><span class="text-sm text-muted-foreground">Page {currentPage + 1} of {pages}</span><div class="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onclick={() => page = currentPage - 1}><ChevronLeftIcon class="size-4" />Previous</Button><Button variant="outline" size="sm" disabled={currentPage + 1 >= pages} onclick={() => page = currentPage + 1}>Next<ChevronRightIcon class="size-4" /></Button></div></div>
		{:else if bookmarks && !loading && !bookmarks.warning}<p class="text-muted-foreground text-sm">No bookmarked mods found.</p>{/if}
	</Card.Content>
</Card.Root>

<ModPreviewSheet bind:open={previewOpen} modName={previewName} />
