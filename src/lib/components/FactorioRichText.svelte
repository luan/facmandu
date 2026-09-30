<script lang="ts">
	import PrototypeIcon from './PrototypeIcon.svelte';
	import { parseFactorioRichText } from '$lib/factorio-rich-text';

	let { text, serverId, inline = true }: { text: string; serverId: string; inline?: boolean } = $props();
	const parts = $derived(parseFactorioRichText(text));
</script>

<span class={inline ? 'whitespace-pre-line' : 'block whitespace-pre-line'}>
	{#each parts as part}
		{#if part.kind === 'text'}
			<span class:font-semibold={part.bold} style:color={part.color}>{part.text}</span>
		{:else}
			<span
				class="inline-flex align-middle"
				role="img"
				aria-label={part.caption}
				title={part.caption}
				style:color={part.color}
			>
				<PrototypeIcon prototype={part.prototype} {serverId} />
			</span>
		{/if}
	{/each}
</span>
