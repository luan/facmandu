<script lang="ts">
	import { bundledModTitle, isBundledMod } from '$lib/dependencies';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { ModSummary } from '$lib/server/db/schema';
	import { ExternalLinkIcon } from '@lucide/svelte';

	interface Props {
		mod: Omit<ModSummary, 'updatedBy'>;
		version: string | null;
		onOpenPreview?: (modName: string) => void;
		showRelationships?: boolean;
		requiredBy?: { name: string; title: string | null; enabled: boolean | null }[];
	}

	let { mod, version, onOpenPreview, requiredBy = [], showRelationships = true }: Props = $props();
</script>

<div class="min-w-0">
	<div class="flex items-center gap-2">
		{#if isBundledMod(mod.name)}<span class="font-medium">{bundledModTitle(mod.name)}</span>{:else}<button type="button" class="text-primary truncate text-left font-medium hover:underline" onclick={() => onOpenPreview?.(mod.name)}>
			{mod.title || mod.name}
		</button>{/if}
		{#if version && !isBundledMod(mod.name)}<span class="shrink-0 text-xs tabular-nums text-muted-foreground">v{version}</span>{/if}
		{#if !isBundledMod(mod.name)}<Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<a {...props} href={`https://mods.factorio.com/mod/${encodeURIComponent(mod.name)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${mod.name} on Factorio Mod Portal`} class="text-muted-foreground hover:text-foreground shrink-0">
			<ExternalLinkIcon class="h-3.5 w-3.5" />
		</a>{/snippet}</Tooltip.Trigger><Tooltip.Content>Factorio Mod Portal</Tooltip.Content></Tooltip.Root>{/if}
	</div>
	<p class="text-muted-foreground truncate text-xs">{mod.name}{mod.category ? ` · ${mod.category}` : ''}</p>
	{#if showRelationships && requiredBy.length}
		<p class="mt-1 text-xs text-muted-foreground">Required by {#each requiredBy.slice(0, 3) as parent, index (parent.name)}{#if index > 0}, {/if}<button type="button" class="text-primary hover:underline" onclick={() => onOpenPreview?.(parent.name)}>{parent.title || parent.name}</button>{#if !parent.enabled} (disabled){/if}{/each}</p>
		{#if requiredBy.length > 3}
			<details class="text-xs text-muted-foreground">
				<summary class="cursor-pointer hover:text-foreground">{requiredBy.length - 3} more</summary>
				<p class="mt-1">{#each requiredBy.slice(3) as parent, index (parent.name)}{#if index > 0}, {/if}<button type="button" class="text-primary hover:underline" onclick={() => onOpenPreview?.(parent.name)}>{parent.title || parent.name}</button>{#if !parent.enabled} (disabled){/if}{/each}</p>
			</details>
		{/if}
	{/if}
</div>
