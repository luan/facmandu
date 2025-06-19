<script lang="ts">
	import { DownloadIcon } from '@lucide/svelte';

	interface Props {
		downloads: number | null;
	}

	let { downloads }: Props = $props();

	function formatDownloads(count?: number | null): string {
		if (!count) return 'N/A';
		if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
		if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
		return count.toString();
	}
</script>

{#if downloads}
	<div class="flex items-center gap-1 text-xs">
		<DownloadIcon class="h-3 w-3" />
		<span>{formatDownloads(downloads)}</span>
	</div>
{:else}
	<span class="text-muted-foreground text-xs">N/A</span>
{/if}
