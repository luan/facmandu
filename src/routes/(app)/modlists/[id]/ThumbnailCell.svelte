<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { Mod } from '$lib/server/db/schema';

	interface Props {
		mod: Mod;
	}

	let { mod }: Props = $props();
</script>

{#if mod.thumbnail}
	<Tooltip.Root>
		<Tooltip.Trigger>
			<img
				src={`https://assets-mod.factorio.com${mod.thumbnail}`}
				alt={mod.title || mod.name}
				class="m-auto h-8 w-8 rounded object-cover"
				loading="lazy"
			/>
		</Tooltip.Trigger>
		<Tooltip.Content>
			<img
				src={`https://assets-mod.factorio.com${mod.thumbnail}`}
				alt={mod.title || mod.name}
				class="h-32 w-32 rounded object-cover"
				loading="lazy"
			/>
		</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<div class="bg-muted flex h-8 w-8 items-center justify-center rounded">
		<span class="text-[10px]">📦</span>
	</div>
{/if}
