<script lang="ts">
	import { modThumbnailUrl } from '$lib/utils';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { PlusIcon, XIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { ModSummary } from '$lib/server/db/schema';
	import ModPreviewSheet from './ModPreviewSheet.svelte';
	let { iceboxMods, factorioVersion, readOnly = false, open = $bindable(false) }: { iceboxMods: Omit<ModSummary, 'updatedBy'>[]; factorioVersion: string; readOnly?: boolean; open?: boolean } = $props();
	let query = $state('');
	let page = $state(0);
	let pending = $state(false);
	let previewOpen = $state(false);
	let previewName = $state<string | null>(null);
	const previewMod = $derived(iceboxMods.find((mod) => mod.name === previewName));
	const filtered = $derived(iceboxMods.filter((mod) => `${mod.name} ${mod.title ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
	const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / 12)));
	const currentPage = $derived(Math.min(page, pageCount - 1));
	const rows = $derived(filtered.slice(currentPage * 12, (currentPage + 1) * 12));
	const submit: SubmitFunction = ({ cancel }) => {
		if (pending) { cancel(); return; } pending = true;
		return async ({ result, update }) => {
			try {
				await update({ invalidateAll: false });
				if (result.type === 'success') await invalidate('app:modlist');
				else toast.error(result.type === 'failure' ? String(result.data?.message || 'Could not update mod') : 'Could not update mod');
			} finally { pending = false; }
		};
	};
</script>
<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col sm:!max-w-2xl">
		<Sheet.Header><Sheet.Title>Icebox</Sheet.Title><Sheet.Description>Mods saved for later.</Sheet.Description></Sheet.Header>
		<div class="px-4"><Input aria-label="Filter icebox mods" placeholder="Filter saved mods…" bind:value={query} oninput={() => { page = 0; }} /></div>
		<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-busy={pending}>
			{#each rows as mod (mod.id)}
				<article class="rounded-lg border p-4">
					<div class="flex gap-3">
						{#if mod.thumbnail}<img src={modThumbnailUrl(mod.thumbnail)} alt="" class="size-16 shrink-0 rounded object-contain" loading="lazy" />{/if}
						<div class="min-w-0 flex-1"><button type="button" class="text-left font-medium text-primary hover:underline" onclick={() => { previewName = mod.name; previewOpen = true; }}>{mod.title || mod.name}</button>{#if mod.version}<span class="ml-2 text-xs text-muted-foreground">v{mod.version}</span>{/if}{#if mod.summary}<p class="mt-1 line-clamp-3 text-sm text-muted-foreground">{mod.summary}</p>{/if}<p class="mt-2 text-xs text-muted-foreground">{mod.name}{mod.category ? ` · ${mod.category}` : ''}</p>{#if mod.fetchError}<p class="mt-2 text-xs text-amber-500">{mod.fetchError}</p>{/if}</div>
					</div>
					{#if !readOnly}<div class="mt-3 flex justify-end gap-2">
						<form method="POST" action="?/removeMod" use:enhance={submit}><input type="hidden" name="modName" value={mod.name} /><Button type="submit" variant="ghost" size="sm" disabled={pending} aria-label={`Remove ${mod.name} from icebox`}><XIcon class="mr-1 size-3.5" />Remove</Button></form>
						<form method="POST" action="?/activateMod" use:enhance={submit}><input type="hidden" name="modId" value={mod.id} /><Button type="submit" size="sm" disabled={pending}><PlusIcon class="mr-1 size-3.5" />Add to list</Button></form>
					</div>{/if}
				</article>
			{:else}<p class="py-8 text-center text-sm text-muted-foreground">{query ? 'No saved mods match this filter.' : 'No mods saved for later.'}</p>{/each}
		</div>
		{#if pageCount > 1}<div class="flex items-center justify-between border-t p-4 text-sm"><span>Page {currentPage + 1} of {pageCount}</span><div class="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onclick={() => { page = currentPage - 1; }}><ChevronLeftIcon class="size-4" />Previous</Button><Button variant="outline" size="sm" disabled={currentPage + 1 >= pageCount} onclick={() => { page = currentPage + 1; }}>Next<ChevronRightIcon class="size-4" /></Button></div></div>{/if}
	</Sheet.Content>
</Sheet.Root>
<ModPreviewSheet bind:open={previewOpen} modName={previewName} modId={previewMod?.id} selectedVersion={previewMod?.version} {factorioVersion} {readOnly} />
