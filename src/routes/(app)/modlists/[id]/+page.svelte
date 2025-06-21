<script lang="ts">
	import type { PageProps } from './$types';
	import ModSearch from './ModSearch.svelte';
	import ModSearchResults from './ModSearchResults.svelte';
	import ModTable from './ModTable.svelte';
	import CredentialsWarning from './CredentialsWarning.svelte';
	import EditableModlistName from './EditableModlistName.svelte';
	import DependencyValidation from './DependencyValidation.svelte';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { TrashIcon } from '@lucide/svelte';
	import { subscribeToModlistUpdates } from '$lib/stores/realtime.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data }: PageProps = $props();
	let modlist = $derived(data.modlist);
	let mods = $derived(data.mods);
	let hasCredentials = $derived(data.hasFactorioCredentials);
	let searchResults = $derived(data.searchResults);
	let searchQuery = $derived(data.searchQuery);
	let searchError = $derived(data.searchError);
	let dependencyValidation = $derived(data.dependencyValidation);

	let showDeleteConfirm = $state(false);
	let unsubscribeRealtime: (() => void) | null = null;

	onMount(() => {
		if (modlist?.id) {
			unsubscribeRealtime = subscribeToModlistUpdates(modlist.id, handleRealtimeUpdate);
		}
	});

	onDestroy(() => {
		if (unsubscribeRealtime) {
			unsubscribeRealtime();
		}
	});

	function handleRealtimeUpdate() {
		// Invalidate all data to refresh from server
		// This ensures we get the latest state including dependency validation
		invalidateAll();
	}
</script>

<div class="flex h-[calc(100svh-var(--header-height))] w-full flex-col gap-4 px-48 py-4">
	<div class="flex items-center justify-between">
		<EditableModlistName name={modlist?.name || ''} modlistId={modlist?.id || ''} />
		<div class="flex items-center gap-2">
			{#if showDeleteConfirm}
				<div class="flex items-center gap-2">
					<span class="text-muted-foreground text-sm">Are you sure?</span>
					<form method="POST" action="?/deleteModlist" use:enhance>
						<Button type="submit" variant="destructive" size="sm">Delete</Button>
					</form>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={() => (showDeleteConfirm = false)}
					>
						Cancel
					</Button>
				</div>
			{:else}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={() => (showDeleteConfirm = true)}
				>
					<TrashIcon class="mr-2 h-4 w-4" />
					Delete Modlist
				</Button>
			{/if}
		</div>
	</div>

	{#if hasCredentials}
		<ModSearch {searchQuery} {searchError} />

		<ModSearchResults {searchResults} query={searchQuery} currentMods={mods} />
	{:else}
		<CredentialsWarning />
	{/if}

	<DependencyValidation {dependencyValidation} {mods} />

	<ModTable
		{mods}
		modlistName={modlist?.name || ''}
		conflictingMods={[
			...new Set(dependencyValidation.conflicts.flatMap((c) => [c.mod, c.conflictsWith]))
		]}
	/>
</div>
