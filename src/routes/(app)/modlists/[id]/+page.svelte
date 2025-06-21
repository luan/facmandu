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
	import { DownloadIcon, ShareIcon, TrashIcon } from '@lucide/svelte';
	import { subscribeToModlistUpdates } from '$lib/stores/realtime.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data }: PageProps = $props();
	let modlist = $derived(data.modlist);
	let mods = $derived(data.mods);
	let collaborators = $derived(data.collaborators);
	let currentUserId = $derived(data.currentUserId);
	let hasCredentials = $derived(data.hasFactorioCredentials);
	let searchResults = $derived(data.searchResults);
	let searchQuery = $derived(data.searchQuery);
	let searchError = $derived(data.searchError);
	let dependencyValidation = $derived(data.dependencyValidation);

	let showDeleteConfirm = $state(false);
	let unsubscribeRealtime: (() => void) | null = null;
	let shareDialogOpen = $state(false);
	let shareError = $state('');
	let shareUsername = $state('');
	let eventSource: EventSource | null = null;
	let exportDialogOpen = $state(false);
	let sessionToken = $derived(data.sessionToken);
	let exportCommand = $state('');

	onMount(() => {
		if (modlist?.id) {
			unsubscribeRealtime = subscribeToModlistUpdates(modlist.id, handleRealtimeUpdate);
			// Open server-sent events for cross-user realtime
			const url = `/api/modlists/${modlist.id}/events`;
			eventSource = new EventSource(url);
			eventSource.onmessage = () => handleRealtimeUpdate();
		}
	});

	onDestroy(() => {
		if (unsubscribeRealtime) {
			unsubscribeRealtime();
		}
		eventSource?.close();
	});

	function handleRealtimeUpdate() {
		// Invalidate all data to refresh from server
		// This ensures we get the latest state including dependency validation
		invalidateAll();
	}

	async function addCollaborator() {
		shareError = '';
		if (!shareUsername.trim()) return;
		const fd = new FormData();
		fd.append('username', shareUsername.trim());
		const res = await fetch('?/shareAdd', { method: 'POST', body: fd });
		if (res.ok) {
			shareUsername = '';
			await invalidateAll();
		} else {
			const data = await res.json().catch(() => ({}));
			shareError = data?.message || 'Failed to share';
		}
	}

	async function removeCollaborator(userId: string) {
		const fd = new FormData();
		fd.append('userId', userId);
		await fetch('?/shareRemove', { method: 'POST', body: fd });
		await invalidateAll();
	}

	function openExportDialog() {
		if (!modlist?.id) return;
		// Build one-liner that fetches the generated script from backend and pipes to bash
		const cookieName = 'auth-session';
		exportCommand = `curl -H "Cookie: ${cookieName}=${sessionToken}" -sL "${location.origin}/api/modlists/${modlist.id}/export" | bash`;
		exportDialogOpen = true;
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
				{#if modlist?.owner === currentUserId}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={() => (shareDialogOpen = true)}
					>
						<ShareIcon class="mr-2 h-4 w-4" />
						Share
					</Button>
					<Button type="button" variant="outline" size="sm" onclick={openExportDialog}>
						<DownloadIcon class="mr-2 h-4 w-4" />
						Export
					</Button>
				{/if}

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

<!-- Share Dialog -->
{#if shareDialogOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-background w-[400px] rounded-md p-6 dark:bg-neutral-900">
			<h2 class="mb-4 text-lg font-semibold">Share Modlist</h2>
			{#if shareError}
				<p class="text-destructive mb-2">{shareError}</p>
			{/if}
			<div class="mb-4 flex gap-2">
				<input
					class="flex-1 rounded-sm border bg-transparent px-2 py-1"
					placeholder="Username"
					bind:value={shareUsername}
				/>
				<Button size="sm" onclick={addCollaborator}>Add</Button>
			</div>

			<div class="max-h-40 space-y-2 overflow-y-auto">
				{#each collaborators as c, i (i)}
					<div class="flex items-center justify-between">
						<span>{c.username}</span>
						<Button variant="destructive" size="sm" onclick={() => removeCollaborator(c.id)}>
							Remove
						</Button>
					</div>
				{/each}
			</div>

			<div class="mt-4 text-right">
				<Button variant="outline" size="sm" onclick={() => (shareDialogOpen = false)}>Close</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Export Dialog -->
{#if exportDialogOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-background w-[400px] rounded-md p-6 dark:bg-neutral-900">
			<h2 class="mb-4 text-lg font-semibold">Export Modlist</h2>
			<div class="mb-4">
				<textarea
					class="flex-1 rounded-sm border bg-transparent px-2 py-1"
					readonly
					bind:value={exportCommand}
				></textarea>
			</div>
			<div class="mt-4 text-right">
				<Button variant="outline" size="sm" onclick={() => (exportDialogOpen = false)}>Close</Button
				>
			</div>
		</div>
	</div>
{/if}
