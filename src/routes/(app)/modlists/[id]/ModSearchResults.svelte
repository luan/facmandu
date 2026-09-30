<script lang="ts">
	import { RefreshCwIcon, PlusIcon, TrashIcon, SnowflakeIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';
	import ModSummary from '$lib/components/ModSummary.svelte';
	import { enhance } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from 'svelte-sonner';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { searchFactorioMods } from '$lib/server/factorio-search';
	import ModPreviewSheet from './ModPreviewSheet.svelte';

	let { currentMods, readOnly = false }: { currentMods: {id: string; name: string; icebox?: boolean | null}[]; readOnly?: boolean } = $props();
	type Results = Awaited<ReturnType<typeof searchFactorioMods>>;
	let result = $state<Results | null>(null);
	let searching = $state(false);
	let errorMessage = $state('');
	let retry = $state(0);
	let pending = $state(new Set<string>());
	let previewOpen = $state(false);
	let previewModName = $state<string | null>(null);
	const existing = $derived(new Map(currentMods.map((mod) => [mod.name, mod])));
	const searchKey = $derived(page.url.search);
	const listId = $derived(page.params.id);
	const queryText = $derived(new URLSearchParams(searchKey).get('q')?.trim() ?? '');
	$effect(() => {
		void retry;
		const query = new URLSearchParams(searchKey);
		const id = listId;
		result = null; errorMessage = ''; searching = false;
		if (!id || !query.get('q')?.trim()) return;
		const controller = new AbortController();
		searching = true;
		void fetch(`/api/modlists/${id}/search?${query}`, {signal: controller.signal}).then(async (response) => {
			if (!response.ok) {
				const body = await response.json().catch(() => null);
				throw new Error(body?.message || `Search is unavailable (HTTP ${response.status}). Try again shortly.`);
			}
			const value: Results = await response.json();
			if (!controller.signal.aborted) result = value;
		}).catch((cause: unknown) => { if (!controller.signal.aborted) errorMessage = cause instanceof Error ? cause.message : 'Search failed'; })
		.finally(() => { if (!controller.signal.aborted) searching = false; });
		return () => controller.abort();
	});
	function changePage(number: number) {
		const query = new URLSearchParams(searchKey); query.set('page', String(number));
		void goto(`${page.url.pathname}?${query}`, {keepFocus: true, noScroll: true});
	}
	const submit: SubmitFunction = ({formData, cancel}) => {
		const name = String(formData.get('modName'));
		if (pending.has(name)) { cancel(); return; }
		pending = new Set(pending).add(name);
		return async ({result, update}) => {
			try {
				await update({reset: false, invalidateAll: false});
				if (result.type === 'success') await invalidate('app:modlist');
				else toast.error(result.type === 'failure' ? String(result.data?.message || 'Could not update mod') : 'Could not update mod');
			} finally { pending = new Set([...pending].filter((item) => item !== name)); }
		};
	};
</script>

{#if searching}
	<p role="status" class="text-muted-foreground py-6 text-sm">Searching the mod portal…</p>
{:else if errorMessage}
	<div role="alert" class="space-y-2 py-4 text-sm"><p class="text-destructive">{errorMessage}</p><Button variant="outline" size="sm" onclick={() => retry++}><RefreshCwIcon class="size-4" />Retry search</Button></div>
{:else if result}
	<div class="space-y-3">
		{#if result.warning}<p role="status" class="text-sm text-amber-500">{result.warning}</p>{/if}
		{#each result.results as mod (mod.name)}
			{@const current = existing.get(mod.name)}
			<article class="space-y-3 rounded-lg border p-4" aria-busy={pending.has(mod.name)}>
                <ModSummary name={mod.name} title={mod.title} thumbnail={mod.thumbnail} owner={mod.owner} version={mod.latest_release_version} summary={mod.summary} preview={() => { previewModName = mod.name; previewOpen = true; }} />
				<div class="flex flex-wrap items-center gap-2 text-xs">
					<span class="text-muted-foreground mr-auto">{(mod.downloads_count ?? 0).toLocaleString()} downloads</span>
					{#if current}<span>{current.icebox ? 'In icebox' : 'In this list'}</span>{/if}
					{#if !readOnly}
						{#if current}
							{#if current.icebox}<form method="POST" action="?/activateMod" use:enhance={submit}><input type="hidden" name="modName" value={mod.name} /><input type="hidden" name="modId" value={current.id} /><Button size="sm" type="submit" disabled={pending.has(mod.name)}><PlusIcon class="size-4" />Add to list</Button></form>{/if}
							<form method="POST" action="?/removeMod" use:enhance={submit}><input type="hidden" name="modName" value={mod.name} /><Button size="sm" variant="ghost" type="submit" disabled={pending.has(mod.name)}><TrashIcon class="size-4" />Remove</Button></form>
						{:else}
							<form method="POST" action="?/addMod" use:enhance={submit}><input type="hidden" name="modName" value={mod.name} /><Button size="sm" type="submit" disabled={pending.has(mod.name)}><PlusIcon class="size-4" />Add to list</Button></form>
							<form method="POST" action="?/addIceboxMod" use:enhance={submit}><input type="hidden" name="modName" value={mod.name} /><Button size="sm" variant="outline" type="submit" disabled={pending.has(mod.name)}><SnowflakeIcon class="size-4" />Icebox</Button></form>
						{/if}
					{/if}
					{#if pending.has(mod.name)}<span role="status">Saving…</span>{/if}
				</div>
			</article>
		{:else}<p class="text-muted-foreground py-6 text-sm">No mods match “{queryText}”. Try another name or adjust the filters.</p>{/each}
		{#if result.totalPages > 1}<nav aria-label="Search result pages" class="flex items-center justify-between gap-3 border-t pt-3 text-sm"><Button variant="outline" size="sm" disabled={result.currentPage <= 1} onclick={() => changePage((result?.currentPage ?? 1) - 1)}><ChevronLeftIcon class="size-4" />Previous</Button><span>Page {result.currentPage} of {result.totalPages}</span><Button variant="outline" size="sm" disabled={result.currentPage >= result.totalPages} onclick={() => changePage((result?.currentPage ?? 1) + 1)}>Next<ChevronRightIcon class="size-4" /></Button></nav>{/if}
	</div>
{:else}<p class="text-muted-foreground py-6 text-sm">Search by name or what you want a mod to do.</p>{/if}
<ModPreviewSheet bind:open={previewOpen} modName={previewModName} />
