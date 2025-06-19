<script lang="ts">
	interface Props {
		version: string | null;
	}

	let { version }: Props = $props();
</script>

{#if version}
	<code class="text-xs">{version}</code>
{:else}
	<span class="text-muted-foreground text-xs">N/A</span>
{/if}
