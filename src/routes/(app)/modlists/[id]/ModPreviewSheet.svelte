<script module lang="ts">
	import type { PortalMod } from '$lib/server/portal-cache';
	const previews = new Map<string, { info: PortalMod; expires: number }>();
</script>
<script lang="ts">
	import { CheckIcon, RefreshCwIcon, ExternalLinkIcon } from '@lucide/svelte';
	import { modThumbnailUrl } from '$lib/utils';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Button from '$lib/components/ui/button/button.svelte';
	import { toast } from 'svelte-sonner';
	import * as Sheet from '$lib/components/ui/sheet';
	import { compareVersions, inspectDependencies, isBundledMod, supportsFactorio } from '$lib/dependencies';
	let { open = $bindable(false), modName = null, modId, selectedVersion, factorioVersion, readOnly = true }: {
		open: boolean; modName: string | null; modId?: string; selectedVersion?: string | null; factorioVersion?: string; readOnly?: boolean;
	} = $props();
	let preferredVersion = $state('');
	let saving = $state(false);
	let saveError = $state('');
	$effect(() => { if (open) { preferredVersion = selectedVersion ?? ''; saveError = ''; } });
	const saveVersion: SubmitFunction = ({ cancel }) => {
		if (saving) { cancel(); return; }
		saving = true; saveError = '';
		return async ({ result, update }) => {
			try {
				await update({ invalidateAll: false, reset: false });
				if (result.type === 'success') { await invalidate('app:modlist'); toast.success('Preferred release saved. Checking dependencies…'); }
				else saveError = result.type === 'failure' ? String(result.data?.message || 'Could not change release.') : 'Could not change release.';
			} finally { saving = false; }
		};
	};
	let info = $state<PortalMod | null>(null);
	let loading = $state(false);
	let errorMessage = $state('');
	let retry = $state(0);
	let historyOpen = $state(false);
	const releases = $derived(info?.releases.toSorted((a, b) => compareVersions(b.version, a.version) ?? 0) ?? []);
	const latest = $derived(releases[0]);
	const compatibleReleases = $derived(releases.filter((release) => !factorioVersion || supportsFactorio(release.info_json.factorio_version, factorioVersion)));
	const shownRelease = $derived(releases.find((release) => release.version === (preferredVersion || selectedVersion)) ?? compatibleReleases[0] ?? latest);
	const dependencies = $derived(inspectDependencies(JSON.stringify(shownRelease?.info_json.dependencies ?? [])).dependencies);
	$effect(() => {
		void retry;
		if (!open || !modName) return;
		const name = modName;
		const cached = previews.get(name);
		const cachedInfo = cached && cached.expires > Date.now() ? cached.info : null;
		info = cachedInfo; errorMessage = ''; loading = !cachedInfo; historyOpen = false;
		if (cachedInfo) return;
		const controller = new AbortController();
		void fetch(`/api/factorio-mods/${encodeURIComponent(name)}`, { signal: controller.signal }).then(async (response) => {
			if (!response.ok) throw new Error(response.status === 404 ? 'This mod is no longer available on the portal.' : 'Metadata is temporarily unavailable.');
			const result: PortalMod = await response.json();
			if (controller.signal.aborted) return;
			if (previews.size >= 100) { const oldest = previews.keys().next().value; if (oldest) previews.delete(oldest); }
			previews.set(name, { info: result, expires: Date.now() + 60_000 }); info = result;
		}).catch((cause: unknown) => { if (!controller.signal.aborted) errorMessage = cause instanceof Error ? cause.message : 'Could not load mod'; }).finally(() => { if (!controller.signal.aborted) loading = false; });
		return () => controller.abort();
	});
</script>
<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full max-w-full! flex-col gap-0 p-0 sm:w-[560px] sm:max-w-[560px]!">
		<Sheet.Header class="shrink-0 border-b p-6 pr-12"><Sheet.Title>{info?.title || modName || 'Mod details'}</Sheet.Title><Sheet.Description>{info?.owner ? `By ${info.owner}` : 'Mod details and release information'}</Sheet.Description></Sheet.Header>
		<div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
			{#if loading}<p role="status" class="text-muted-foreground text-sm">Loading mod details…</p>{/if}
			{#if errorMessage}<p role="alert" class="text-amber-500 text-sm">{errorMessage}</p><button type="button" class="inline-flex items-center gap-1 text-sm underline" onclick={() => retry++}><RefreshCwIcon class="size-4" />Retry</button>{/if}
			{#if info}
				<div class="flex items-start gap-4">{#if info.thumbnail}<img src={modThumbnailUrl(info.thumbnail)} alt="" class="size-20 shrink-0 rounded-lg object-cover" />{/if}<p class="text-sm leading-relaxed">{info.summary || 'No summary provided.'}</p></div>
				<dl class="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm"><div><dt class="text-muted-foreground text-xs">Downloads</dt><dd class="mt-1 font-medium">{(info.downloads_count ?? 0).toLocaleString()}</dd></div><div><dt class="text-muted-foreground text-xs">Category</dt><dd class="mt-1 font-medium">{info.category || 'Uncategorized'}</dd></div><div><dt class="text-muted-foreground text-xs">{selectedVersion ? 'In this list' : 'Latest release'}</dt><dd class="mt-1 font-medium">{selectedVersion || latest?.version || 'Unavailable'}</dd></div><div><dt class="text-muted-foreground text-xs">Factorio versions</dt><dd class="mt-1 font-medium">{[...new Set(releases.map((release) => release.info_json.factorio_version))].join(', ')}</dd></div></dl>
				{#if modId && !readOnly && modName && !isBundledMod(modName)}
					<form method="POST" action="?/setModVersion" use:enhance={saveVersion} class="space-y-3 rounded-lg border p-4" aria-busy={saving}>
						<input type="hidden" name="modId" value={modId} />
						<label for="preferred-mod-release" class="block text-sm font-medium">Preferred release · Factorio {factorioVersion}</label>
						<div class="flex flex-wrap gap-2"><select id="preferred-mod-release" name="version" bind:value={preferredVersion} disabled={saving || !compatibleReleases.length} class="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm">
							{#if !compatibleReleases.some((release) => release.version === preferredVersion)}<option value={preferredVersion} disabled>{preferredVersion ? `${preferredVersion} · incompatible` : 'Choose a release'}</option>{/if}
							{#each compatibleReleases as release (release.version)}<option value={release.version}>{release.version}{release.version === selectedVersion ? ' · current' : ''}{release === compatibleReleases[0] ? ' · latest compatible' : ''}</option>{/each}
						</select><Button type="submit" size="sm" disabled={saving || !preferredVersion || preferredVersion === selectedVersion || !compatibleReleases.some((release) => release.version === preferredVersion)}><CheckIcon class="size-4" />{saving ? 'Saving…' : 'Use release'}</Button></div>
						<p class="text-xs text-muted-foreground">{compatibleReleases.length ? 'Repair keeps this release unless dependencies require another. Changes appear in the repair results. Server mods change only when you review and apply the list.' : 'No release supports this list’s Factorio branch.'}</p>
						{#if saveError}<p role="alert" class="text-sm text-destructive">{saveError}</p>{/if}
					</form>
				{/if}
				{#if dependencies.length}<section><h3 class="mb-3 text-sm font-semibold">Dependencies of {shownRelease?.version}</h3><ul class="space-y-2 text-sm">{#each dependencies as dependency, index (index)}<li class="flex justify-between gap-3"><span>{dependency.name}{dependency.version ? ` ${dependency.version.operator} ${dependency.version.version}` : ''}</span><span class="text-muted-foreground text-xs capitalize">{dependency.type}</span></li>{/each}</ul></section>{/if}
				<details bind:open={historyOpen}><summary class="cursor-pointer text-sm font-medium">Release history ({releases.length})</summary>{#if historyOpen}<ul class="mt-3 max-h-64 space-y-2 overflow-auto text-sm">{#each releases.slice(0, 50) as release, index (index)}<li class="flex justify-between gap-3"><span>{release.version}</span><span class="text-muted-foreground">Factorio {release.info_json.factorio_version}</span></li>{/each}</ul>{#if releases.length > 50}<p class="mt-2 text-xs text-muted-foreground">Showing the latest 50 releases. The complete history is available on the portal.</p>{/if}{/if}</details>
				{#if info.description}<details><summary class="cursor-pointer text-sm font-medium">Full description</summary><p class="text-muted-foreground mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{info.description}</p></details>{/if}
			{/if}
		</div>
		{#if modName}<div class="shrink-0 border-t p-4"><a href={`https://mods.factorio.com/mod/${encodeURIComponent(modName)}`} target="_blank" rel="noopener noreferrer" class="text-primary inline-flex items-center gap-2 text-sm hover:underline"><ExternalLinkIcon class="size-4" />Open on Factorio Mod Portal</a></div>{/if}
	</Sheet.Content>
</Sheet.Root>
