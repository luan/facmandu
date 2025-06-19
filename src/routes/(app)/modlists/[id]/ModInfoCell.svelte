<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { Mod } from '$lib/server/db/schema';

	interface Props {
		mod: Mod;
	}

	let { mod }: Props = $props();
</script>

<div class="space-y-1">
	<div class="font-medium">
		{#if mod.summary}
			<Tooltip.Root>
				<Tooltip.Trigger class="text-left">
					{mod.title || mod.name}
				</Tooltip.Trigger>
				<Tooltip.Content class="max-w-80">
					<div class="space-y-2">
						<p class="font-semibold">{mod.title || mod.name}</p>
						<p class="text-sm">{mod.summary}</p>
					</div>
				</Tooltip.Content>
			</Tooltip.Root>
		{:else}
			{mod.title || mod.name}
		{/if}
	</div>
	{#if mod.title && mod.title !== mod.name}
		<div class="text-muted-foreground text-xs">({mod.name})</div>
	{/if}
</div>
