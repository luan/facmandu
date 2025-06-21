<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { Mod } from '$lib/server/db/schema';
	import { ExternalLinkIcon } from '@lucide/svelte';

	interface Props {
		mod: Mod;
	}

	let { mod }: Props = $props();

	const modPortalUrl = `https://mods.factorio.com/mod/${mod.name}`;
</script>

<div class="space-y-1">
	<div class="font-medium">
		{#if mod.summary}
			<Tooltip.Root>
				<Tooltip.Trigger class="text-left">
					<a
						href={modPortalUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="hover:text-primary inline-flex items-center gap-1 hover:underline"
					>
						{mod.title || mod.name}
						<ExternalLinkIcon class="h-3 w-3 opacity-60" />
					</a>
				</Tooltip.Trigger>
				<Tooltip.Content class="max-w-80">
					<div class="space-y-2">
						<p class="font-semibold">{mod.title || mod.name}</p>
						<p class="text-sm">{mod.summary}</p>
						<p class="text-muted-foreground text-xs">Click to view on Factorio Mod Portal</p>
					</div>
				</Tooltip.Content>
			</Tooltip.Root>
		{:else}
			<a
				href={modPortalUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="hover:text-primary inline-flex items-center gap-1 hover:underline"
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
