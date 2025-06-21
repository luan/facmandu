<script lang="ts">
	import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon } from '@lucide/svelte';
	import type { Header } from '@tanstack/table-core';
	import type { Snippet } from 'svelte';

	interface Props {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		header: Header<any, unknown>;
		children: Snippet;
	}

	let { header, children }: Props = $props();

	function handleClick() {
		header.column.getToggleSortingHandler()?.({} as Event);
	}

	let sortDirection = $derived(header.column.getIsSorted());
</script>

<button
	type="button"
	class="hover:text-foreground flex items-center gap-2"
	onclick={handleClick}
	disabled={!header.column.getCanSort()}
>
	<span>{@render children()}</span>

	{#if header.column.getCanSort()}
		{#if sortDirection === 'asc'}
			<ChevronUpIcon class="h-4 w-4" />
		{:else if sortDirection === 'desc'}
			<ChevronDownIcon class="h-4 w-4" />
		{:else}
			<ChevronsUpDownIcon class="h-4 w-4 opacity-50" />
		{/if}
	{/if}
</button>
