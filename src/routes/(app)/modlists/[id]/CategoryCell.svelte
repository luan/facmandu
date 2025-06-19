<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		category: string | null;
	}

	let { category }: Props = $props();
</script>

{#if category}
	<Badge variant="secondary" class="text-xs capitalize">
		{category}
	</Badge>
{:else}
	<span class="text-muted-foreground text-xs">N/A</span>
{/if}
