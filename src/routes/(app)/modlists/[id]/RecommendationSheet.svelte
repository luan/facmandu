<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';
	import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
	import { modThumbnailUrl } from '$lib/utils';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { MessageSquareIcon, PlusIcon, UndoIcon, EyeOffIcon, EyeIcon, RefreshCwIcon, ChevronLeftIcon, ChevronRightIcon, PackageIcon, LinkIcon, LoaderCircleIcon } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { recommendationCandidates, recommendationRelease, recommendationPriority, recommendationPageSize, type RecommendationMod } from '$lib/recommendations';
	import type { RecommendationRating } from '$lib/recommendation-ranking';
	import type { PortalMod } from '$lib/server/portal-cache';
	import { createRejectedRecommendationsStore } from '$lib/stores/rejected-recommendations.svelte';
	import ModPreviewSheet from './ModPreviewSheet.svelte';

	let { mods, modlistId, factorioVersion, curationAvailable, canEdit, open = $bindable(false) }: { mods: (RecommendationMod & { title?: string | null; version?: string | null; summary?: string | null; lastFetched?: Date | null })[]; modlistId: string; factorioVersion: string; curationAvailable: boolean; canEdit: boolean; open?: boolean } = $props();
	let page = $state(0);
	let showDismissed = $state(false);
	let details = $state<Record<string, PortalMod | null>>({});
	let errors = $state<Record<string, string>>({});
	let scores = $state<Record<string, RecommendationRating>>({});
	let scoreContexts = $state<Record<string, string>>({});
	let ranking = $state(false);
	let rankingAttempt = $state(0);
	let rankingMessage = $state<{ error: boolean; message: string } | null>(null);
	let retry = $state(0);
	let adding = $state<string | null>(null);
	let previewOpen = $state(false);
	let previewName = $state<string | null>(null);
	const rejected = $derived(createRejectedRecommendationsStore(modlistId));
 $effect(() => { const preferences = rejected; if (open && canEdit) void untrack(() => preferences.load(true)); });
	const listContext = $derived(JSON.stringify([modlistId, factorioVersion, mods.filter((mod) => mod.enabled).map((mod) => [mod.name, mod.dependencies, mod.version, mod.summary, mod.lastFetched])]));
	// Keep recent choices bounded; restore removes a choice from future ranking requests.
	const dismissedNames = $derived([...rejected.rejected].slice(-40).sort());
	const context = $derived(JSON.stringify([listContext, dismissedNames]));
	$effect(() => { void listContext; scores = {}; scoreContexts = {}; rankingMessage = null; });
	const candidates = $derived(recommendationCandidates(mods));
	const modTitles = $derived(new Map(mods.map((mod) => [mod.name, mod.title || mod.name])));
	const visible = $derived(showDismissed
		? [...rejected.rejected].sort().map((name) => candidates.find((candidate) => candidate.name === name) ?? { name, recommendedBy: [], requirements: [] })
		: candidates.filter((candidate) => !rejected.isRejected(candidate.name)));
	const pageCount = $derived(Math.max(1, Math.ceil(visible.length / recommendationPageSize)));
	const currentPage = $derived(Math.min(page, pageCount - 1));
	// Score sorting must not change which candidates are fetched or ranked.
	const pageCandidates = $derived(visible.slice(currentPage * recommendationPageSize, (currentPage + 1) * recommendationPageSize));
	const rows = $derived(pageCandidates.toSorted((a, b) => recommendationPriority(scores[b.name]) - recommendationPriority(scores[a.name])));
	const checking = $derived(pageCandidates.filter((candidate) => details[candidate.name] === undefined).length);
	const compatibleNames = $derived(pageCandidates.filter((candidate) => details[candidate.name] && recommendationRelease(details[candidate.name]?.releases ?? [], candidate, mods, factorioVersion)).map((candidate) => candidate.name));
	const dismissed = $derived(rejected.rejected.size);

	$effect(() => {
		if (!open) return;
		void retry;
		const names = pageCandidates.map((candidate) => candidate.name);
		const controller = new AbortController();
		for (const name of names) {
			if (untrack(() => details[name] !== undefined)) continue;
			void fetch(`/api/factorio-mods/${encodeURIComponent(name)}`, { signal: controller.signal }).then(async (response) => {
				if (!response.ok) throw new Error(response.status === 404 ? 'No longer on the mod portal' : 'Metadata unavailable');
				const detail: PortalMod = await response.json();
				if (!controller.signal.aborted) details[name] = detail;
			}).catch((cause) => {
				if (!controller.signal.aborted) { details[name] = null; errors[name] = cause instanceof Error ? cause.message : 'Metadata unavailable'; }
			});
		}
		return () => controller.abort();
	});

	$effect(() => {
		const rankingContext = context;
		const feedback = dismissedNames;
		void rankingAttempt;
		ranking = false;
		rankingMessage = null;
		if (!open || showDismissed || !curationAvailable || !rejected.loaded || checking) return;
		const names = compatibleNames;
		if (!names.length || untrack(() => names.every((name) => scores[name] && scoreContexts[name] === rankingContext))) return;
		const controller = new AbortController();
		ranking = true;
		const timer = setTimeout(() => { void (async () => {
			try {
				const response = await fetch(`/api/modlists/${modlistId}/recommendations`, {
					method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ names, dismissed: feedback }),
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
				});
				const result: { scores?: typeof scores; message?: string; warning?: string } = await response.json().catch(() => { throw new Error('Ranking is unavailable. Please retry.'); });
				if (controller.signal.aborted || rankingContext !== context) return;
				if (!response.ok) throw new Error(result.message || 'Could not rank recommendations');
				if (!Object.keys(result.scores ?? {}).length) throw new Error('No rankings returned.');
				scores = { ...scores, ...result.scores };
				scoreContexts = { ...scoreContexts, ...Object.fromEntries(Object.keys(result.scores ?? {}).map((name) => [name, rankingContext])) };
				if (result.warning) rankingMessage = { error: false, message: result.warning };
			} catch (cause) {
				if (!controller.signal.aborted) rankingMessage = { error: true, message: cause instanceof Error && cause.name === 'TimeoutError' ? 'Ranking timed out.' : cause instanceof Error ? cause.message : 'Could not rank recommendations' };
			} finally { if (!controller.signal.aborted) ranking = false; }
		})(); }, 300);
		return () => { clearTimeout(timer); controller.abort(); };
	});
</script>
<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col sm:!max-w-[52rem]">
		<Sheet.Header class="border-b pr-12 pb-4"><Sheet.Title>Recommended mods</Sheet.Title><Sheet.Description>Factorio {factorioVersion}</Sheet.Description></Sheet.Header>
		<div class="flex flex-wrap items-center justify-between gap-2 px-4">
			<Button variant="ghost" size="sm" onclick={() => { showDismissed = !showDismissed; page = 0; }}>{#if showDismissed}<EyeIcon class="size-4" />{:else}<EyeOffIcon class="size-4" />{/if}{showDismissed ? 'Show recommendations' : `Dismissed (${dismissed})`}</Button>
			<div class="text-xs text-muted-foreground" aria-live="polite">
				{#if checking}<span role="status">Checking {checking} mods…</span>
				{:else if ranking}<span role="status" class="inline-flex items-center gap-2"><LoaderCircleIcon class="size-3.5 animate-spin motion-reduce:animate-none" />Ranking…</span>{/if}
			</div>
		</div>
		{#if !curationAvailable}<p class="px-4 text-sm text-muted-foreground">Ranking needs the list owner’s TypeSafe key in account settings.</p>{/if}
		{#if rankingMessage}<div class="flex items-center gap-3 px-4 text-sm" role={rankingMessage.error ? 'alert' : 'status'}><p class="text-muted-foreground">{rankingMessage.message}</p>{#if rankingMessage.error}<Button variant="outline" size="sm" onclick={() => rankingAttempt++}><RefreshCwIcon class="size-4" />Retry ranking</Button>{/if}</div>{/if}
		<div class="min-h-0 flex-1 divide-y overflow-y-auto px-4">
			{#each rows as candidate (candidate.name)}
				{@const detail = details[candidate.name]}
				{@const score = scores[candidate.name]}
				{@const release = detail && recommendationRelease(detail.releases, candidate, mods, factorioVersion)}
				<article class="grid grid-cols-[4rem_minmax(0,1fr)] gap-4 py-5 sm:grid-cols-[5rem_minmax(0,1fr)_7rem]" aria-label={detail?.title || candidate.name}>
					<button type="button" class="self-start overflow-hidden rounded border bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Preview ${detail?.title || candidate.name}`} onclick={() => { previewName = candidate.name; previewOpen = true; }}>
						{#if detail?.thumbnail}<img src={modThumbnailUrl(detail.thumbnail)} alt="" class="aspect-square w-full object-contain" loading="lazy" />{:else}<span class="flex aspect-square items-center justify-center"><PackageIcon class="size-8 text-muted-foreground" /></span>{/if}
					</button>
					<div class="min-w-0">
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<h3 class="min-w-0 text-base font-semibold"><button type="button" class="text-left break-words hover:text-primary hover:underline" onclick={() => { previewName = candidate.name; previewOpen = true; }}>{detail?.title || candidate.name}</button></h3>
							{#if release}<span class="shrink-0 text-xs tabular-nums text-muted-foreground">v{release.version}</span>{/if}
						</div>
						{#if score}
							<div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs leading-normal tabular-nums">
								<Tooltip.Root><Tooltip.Trigger class="font-semibold text-primary" aria-label={`Recommendation score: ${score.score.toFixed(1)} out of 10`}>{score.score.toFixed(1)} / 10</Tooltip.Trigger><Tooltip.Content>Gameplay fit 45% · Added value 35% · Integration 20%. Confidence carries more weight than score.</Tooltip.Content></Tooltip.Root>
								<Tooltip.Root><Tooltip.Trigger class="text-muted-foreground">{Math.round(score.confidence * 100)}% confidence</Tooltip.Trigger><Tooltip.Content>Lowest confidence across the three ratings. Measures certainty of the rating, not whether you’ll like the mod.</Tooltip.Content></Tooltip.Root>
							</div>
						{/if}
						{#if detail?.summary}<p class="mt-2 text-sm leading-relaxed text-foreground/85">{detail.summary}</p>{/if}
						{#if score}
							<details class="group mt-3 text-xs">
								<summary class="flex cursor-pointer list-none items-center gap-1.5 text-primary [&::-webkit-details-marker]:hidden"><ChevronRightIcon class="size-3.5 shrink-0 group-open:rotate-90" />Why this mod</summary>
								<dl class="mt-2 space-y-3 border-l border-primary/30 pl-3">
									{#each score.dimensions as dimension (dimension.label)}
										<div><dt class="flex flex-wrap items-baseline justify-between gap-2"><span class="font-medium">{dimension.label}</span><span class="tabular-nums">{dimension.score.toFixed(1)} / 10 <span class="ml-2 text-muted-foreground">{Math.round(dimension.confidence * 100)}%</span></span></dt><dd class="mt-1 text-muted-foreground">{dimension.assessment}</dd></div>
									{/each}
								</dl>
							</details>
						{/if}
						{#if candidate.recommendedBy.length}<details class="group mt-3 text-xs">
							<summary class="flex cursor-pointer list-none items-start gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"><ChevronRightIcon class="mt-0.5 size-3.5 shrink-0 group-open:rotate-90" /><span>{candidate.recommendedBy.length} enabled {candidate.recommendedBy.length === 1 ? 'mod lists' : 'mods list'} this as an optional dependency</span></summary>
							<ul class="mt-2 grid gap-2 pl-5 sm:grid-cols-2">
								{#each candidate.recommendedBy as name (name)}<li class="min-w-0"><button type="button" class="inline-flex items-start gap-1.5 text-left text-primary hover:underline" onclick={() => { previewName = name; previewOpen = true; }}><LinkIcon class="mt-0.5 size-3.5 shrink-0" /><span class="break-words">{modTitles.get(name) || name}</span></button></li>{/each}
							</ul>
						</details>{/if}
						{#if detail === undefined}<p class="mt-3 text-xs text-muted-foreground">Checking compatibility…</p>
						{:else if errors[candidate.name]}<p class="mt-3 text-xs text-destructive">{errors[candidate.name]}</p>
						{:else if !release}<p class="mt-3 text-xs text-amber-500">No compatible Factorio {factorioVersion} release</p>{/if}
					</div>
					<div class="col-span-2 flex items-start justify-end sm:col-span-1 sm:col-start-3 sm:row-start-1">
						<div class="flex flex-wrap gap-2 sm:w-full sm:flex-col">
							{#if errors[candidate.name]}<Button variant="outline" size="sm" onclick={() => { delete details[candidate.name]; delete errors[candidate.name]; retry++; }}><RefreshCwIcon class="size-4" />Retry</Button>{/if}
							{#if showDismissed}<Button variant="ghost" size="sm" disabled={!canEdit || rejected.pending} onclick={() => void rejected.unreject(candidate.name)}><UndoIcon class="size-4" />Restore</Button>{:else}

								<form method="POST" action="?/addMod" use:enhance={({ cancel }) => {
									if (adding) { cancel(); return; } adding = candidate.name;
									return async ({ result, update }) => { try { await update({ invalidateAll: false }); if (result.type === 'success') await invalidate('app:modlist'); else toast.error(result.type === 'failure' ? String(result.data?.message || 'Could not add mod') : 'Could not add mod'); } finally { adding = null; } };
								}}><input type="hidden" name="modName" value={candidate.name} /><TooltipButton type="submit" size="sm" class="w-full" aria-label={`Add ${detail?.title || candidate.name}`} tooltip={!canEdit ? 'Read-only list' : adding ? 'Adding mod' : detail === undefined ? 'Checking compatibility' : errors[candidate.name] || (!release ? `No compatible Factorio ${factorioVersion} release` : 'Add mod')} disabled={!canEdit || !release || adding !== null}>{#if adding === candidate.name}<LoaderCircleIcon class="size-4 animate-spin motion-reduce:animate-none" />{:else}<PlusIcon class="size-4" />{/if}{adding === candidate.name ? 'Adding…' : 'Add'}</TooltipButton></form>
						<TooltipButton variant="outline" size="sm" disabled={!canEdit} tooltip={canEdit ? 'Explain fit' : 'Read-only list'} onclick={() => { open = false; window.dispatchEvent(new CustomEvent('facmandu-explain', { detail: candidate.name })); }}><MessageSquareIcon class="size-4" />Explain fit</TooltipButton>
								<Button variant="ghost" size="sm" aria-label={`Dismiss ${detail?.title || candidate.name}`} disabled={!canEdit || rejected.pending} onclick={() => void rejected.reject(candidate.name)}><EyeOffIcon class="size-4" />Dismiss</Button>
							{/if}
						</div>
					</div>
				</article>
			{:else}<p class="py-8 text-center text-sm text-muted-foreground">{showDismissed ? 'No dismissed recommendations.' : 'No recommendations for this list.'}</p>{/each}
		</div>
		{#if pageCount > 1}<div class="flex items-center justify-between border-t p-4 text-sm"><span>Page {currentPage + 1} of {pageCount}</span><div class="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onclick={() => { page = currentPage - 1; }}><ChevronLeftIcon class="size-4" />Previous</Button><Button variant="outline" size="sm" disabled={currentPage + 1 >= pageCount} onclick={() => { page = currentPage + 1; }}>Next<ChevronRightIcon class="size-4" /></Button></div></div>{/if}
	</Sheet.Content>
</Sheet.Root>
<ModPreviewSheet bind:open={previewOpen} modName={previewName} {factorioVersion} />
