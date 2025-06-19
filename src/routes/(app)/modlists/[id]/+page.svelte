<script lang="ts">
	import type { PageProps } from './$types';
	import ModSearch from './ModSearch.svelte';
	import ModSearchResults from './ModSearchResults.svelte';
	import ModTable from './ModTable.svelte';
	import CredentialsWarning from './CredentialsWarning.svelte';

	let { data }: PageProps = $props();
	let modlist = $derived(data.modlist);
	let mods = $derived(data.mods);
	let hasCredentials = $derived(data.hasFactorioCredentials);
	let searchResults = $derived(data.searchResults);
	let searchQuery = $derived(data.searchQuery);
	let searchError = $derived(data.searchError);
</script>

<div class="flex h-[calc(100svh-var(--header-height))] w-full flex-col gap-4 px-48 py-4">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">{modlist?.name}</h1>
	</div>

	{#if hasCredentials}
		<ModSearch {searchQuery} {searchError} />

		<ModSearchResults {searchResults} query={searchQuery} currentMods={mods} />
	{:else}
		<CredentialsWarning />
	{/if}

	<ModTable {mods} modlistName={modlist?.name || ''} />
</div>
