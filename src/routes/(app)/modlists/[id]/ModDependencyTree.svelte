<script lang="ts">
	import { ChevronDownIcon, ChevronRightIcon } from '@lucide/svelte';
	import { bundledModTitle, isBundledMod, satisfiesVersion, type ParsedDependency } from '$lib/dependencies';
	import { dependencyTreeMatches, modDependencyGraph } from '$lib/mod-dependency-tree';
	import type { ModSummary } from '$lib/server/db/schema';
	import ModInfoCell from './ModInfoCell.svelte';
	import ThumbnailCell from './ThumbnailCell.svelte';

	let { mods, matches, filtering, onOpenPreview }: {
		mods: Omit<ModSummary, 'updatedBy'>[];
		matches: Set<string>;
		filtering: boolean;
		onOpenPreview: (name: string) => void;
	} = $props();
	const graph = $derived(modDependencyGraph(mods));
	const visible = $derived(filtering ? dependencyTreeMatches(graph.children, matches) : null);
	let expanded = $state(new Set<string>());
	let collapsedMatches = $state(new Set<string>());
	function toggle(path: string, open: boolean) {
		if (filtering) {
			const next = new Set(collapsedMatches);
			if (open) next.add(path); else next.delete(path);
			collapsedMatches = next;
		} else {
			const next = new Set(expanded);
			if (open) next.delete(path); else next.add(path);
			expanded = next;
		}
	}
</script>

{#snippet branch(name: string, ancestors: string[], requirement?: ParsedDependency)}
	{@const mod = graph.byName.get(name)}
	{@const path = JSON.stringify([...ancestors, name])}
	{@const cycle = ancestors.includes(name)}
	{@const children = (graph.children.get(name) ?? []).filter((dep) => !visible || visible.has(dep.name) || matches.has(name))}
	{@const open = filtering ? !collapsedMatches.has(path) : expanded.has(path)}
	{@const title = mod?.title || bundledModTitle(name) || name}
	<li>
		<div class="dependency-row" class:context={filtering && !matches.has(name)}>
			{#if children.length && !cycle}
				<button type="button" class="branch-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} dependencies of ${title}`} aria-expanded={open} onclick={() => toggle(path, open)}>
					{#if open}<ChevronDownIcon class="size-4" />{:else}<ChevronRightIcon class="size-4" />{/if}
				</button>
			{:else}<span class="branch-toggle" aria-hidden="true"></span>{/if}
			{#if mod}<div class="size-10 shrink-0"><ThumbnailCell {mod} /></div>{/if}
			<div class="min-w-0 flex-1">
				{#if mod}<ModInfoCell {mod} version={mod.version} {onOpenPreview} showRelationships={false} />
				{:else if isBundledMod(name)}<span class="font-medium">{title}</span>
				{:else}<button type="button" class="text-primary font-medium hover:underline" onclick={() => onOpenPreview(name)}>{title}</button>{/if}
				<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
					{#if requirement}<span>Required{requirement.version ? ` ${requirement.version.operator} ${requirement.version.version}` : ''}</span>{/if}
					{#if cycle}<span class="text-amber-500">Circular dependency</span>
					{:else if children.length}<span>{children.length} dependenc{children.length === 1 ? 'y' : 'ies'}</span>{/if}
					{#if mod?.dependencies === null}<span>Dependencies not loaded</span>{/if}
					{#if mod?.fetchError}<span class="text-amber-500">{mod.fetchError}</span>{/if}
				</div>
			</div>
			{#if !mod && !isBundledMod(name)}<span class="text-xs text-destructive">Missing</span>
			{:else if mod && !mod.enabled}<span class={requirement?.type === 'required' ? 'text-xs text-amber-500' : 'text-xs text-muted-foreground'}>Disabled</span>
			{:else if requirement?.version && mod?.version && !satisfiesVersion(mod.version, requirement.version)}<span class="text-xs text-destructive">Version mismatch</span>
			{:else if mod?.essential}<span class="text-xs text-amber-500">Locked</span>{/if}
		</div>
		{#if open && !cycle && children.length}
			<ul class="branches">{#each children as dep, index (`${dep.name}:${index}`)}{@render branch(dep.name, [...ancestors, name], dep)}{/each}</ul>
		{/if}
	</li>
{/snippet}

<ul class="dependency-tree" aria-label="Mod dependencies">
	{#each graph.roots.filter((mod) => !visible || visible.has(mod.name)) as mod (mod.name)}
		{@render branch(mod.name, [])}
	{:else}<li class="p-8 text-center text-muted-foreground">No mods match these filters.</li>{/each}
</ul>

<style>
	.dependency-tree { border: 1px solid var(--border); }
	.dependency-tree > li + li { border-top: 1px solid var(--border); }
	.dependency-row { display: flex; align-items: center; gap: .75rem; padding: .65rem .75rem; min-width: 0; }
	.branch-toggle { display: flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; flex-shrink: 0; }
	button.branch-toggle:hover { background: var(--muted); }
	.branches { margin-left: 1.6rem; border-left: 1px solid var(--border); }
	.context { background: color-mix(in srgb, var(--muted) 35%, transparent); }
	@media (max-width: 640px) { .branches { margin-left: .65rem; } .dependency-row { gap: .4rem; padding-inline: .4rem; } }
</style>
