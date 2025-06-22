<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { Mod } from '$lib/server/db/schema';
	import { ExternalLinkIcon } from '@lucide/svelte';

	interface Props {
		mod: Mod;
		version: string | null;
		onOpenPreview?: (modName: string) => void;
	}

	let { mod, version, onOpenPreview }: Props = $props();

	let modPortalUrl = $derived(`https://mods.factorio.com/mod/${mod.name}`);

	function handleClick(event: MouseEvent) {
		// Ignore non-primary clicks or clicks with modifier keys to allow default browser behaviors
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}

		event.preventDefault();
		onOpenPreview?.(mod.name);
	}
</script>

<div class="space-y-1">
	<div class="font-medium">
		{#if mod.summary}
			<Tooltip.Root>
				<Tooltip.Trigger class="text-left">
					<a
						href={modPortalUrl}
						rel="noopener noreferrer"
						class="hover:text-primary inline-flex items-center gap-1 hover:underline"
						onclick={handleClick}
					>
						{mod.title || mod.name}
						<ExternalLinkIcon class="h-3 w-3 opacity-60" />
					</a>
				</Tooltip.Trigger>
				<Tooltip.Content class="max-w-80">
					<div class="space-y-2">
						<p class="font-semibold">
							{mod.title || mod.name}
							{#if version}
								<span class="text-muted-foreground text-xs">({version})</span>
							{/if}
						</p>
						<p class="text-sm">{mod.summary}</p>
						<p class="text-muted-foreground text-xs">Click to view on Factorio Mod Portal</p>
					</div>
				</Tooltip.Content>
			</Tooltip.Root>
		{:else}
			<a
				href={modPortalUrl}
				rel="noopener noreferrer"
				class="hover:text-primary inline-flex items-center gap-1 hover:underline"
				onclick={handleClick}
			>
				{mod.title || mod.name}
				<ExternalLinkIcon class="h-3 w-3 opacity-60" />
			</a>
		{/if}
	</div>
	{#if mod.title && mod.title !== mod.name}
		<div class="text-muted-foreground text-xs">({mod.name})</div>
	{/if}
</div>
