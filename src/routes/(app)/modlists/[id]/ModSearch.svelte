<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { SearchIcon } from '@lucide/svelte';

	interface Props {
		searchQuery: string;
		searchError: string | null;
	}

	let { searchQuery, searchError }: Props = $props();
	let currentQuery = $state(searchQuery);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Search Mods</Card.Title>
		<Card.Description>Search for mods from the Factorio mod portal</Card.Description>
	</Card.Header>
	<Card.Content>
		<form method="GET" class="flex gap-2">
			<Input name="q" placeholder="Search for mods..." bind:value={currentQuery} class="flex-1" />
			<Button type="submit" disabled={!currentQuery.trim()}>
				<SearchIcon class="mr-2 h-4 w-4" />
				Search
			</Button>
		</form>

		{#if searchError}
			<div class="text-destructive mt-2 text-sm">
				{searchError}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
