<script lang="ts">
	import { PackageIcon } from '@lucide/svelte';
	import { modThumbnailUrl } from '$lib/utils';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { ModSummary } from '$lib/server/db/schema';

	interface Props {
		mod: Omit<ModSummary, 'updatedBy'>;
	}

	let { mod }: Props = $props();
</script>

{#if mod.thumbnail}
	<Tooltip.Root>
		<Tooltip.Trigger>
			<img
				src={modThumbnailUrl(mod.thumbnail)}
				alt={mod.title || mod.name}
				class="m-auto h-8 w-8 rounded object-cover {mod.enabled ? '' : 'grayscale'}"
				loading="lazy"
			/>
		</Tooltip.Trigger>
		<Tooltip.Content>
			<img
				src={modThumbnailUrl(mod.thumbnail)}
				alt={mod.title || mod.name}
				class="h-32 w-32 rounded object-cover {mod.enabled ? '' : 'grayscale'}"
				loading="lazy"
			/>
		</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<div
		class="bg-muted flex h-8 w-8 items-center justify-center rounded {mod.enabled
			? ''
			: 'grayscale'}"
	>
		<PackageIcon class="size-4 text-muted-foreground" />
	</div>
{/if}
