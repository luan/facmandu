<script lang="ts">
	import { ClockIcon } from '@lucide/svelte';

	interface Props {
		lastUpdated: Date | null;
	}

	let { lastUpdated }: Props = $props();

	function formatDate(date?: Date | null): string {
		if (!date) return 'N/A';
		try {
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

			if (diffDays < 1) return 'Today';
			if (diffDays < 30) return `${diffDays}d`;
			if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
			return `${Math.floor(diffDays / 365)}y`;
		} catch {
			return 'N/A';
		}
	}
</script>

{#if lastUpdated}
	<div class="text-muted-foreground flex items-center gap-1 text-xs">
		<ClockIcon class="h-3 w-3" />
		<span>{formatDate(lastUpdated)}</span>
	</div>
{:else}
	<span class="text-muted-foreground text-xs">N/A</span>
{/if}
