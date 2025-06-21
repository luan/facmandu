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
	import * as Dialog from '$lib/components/ui/dialog';

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
	let sessionToken = $derived(data.sessionToken);
	let exportCopied = $state(false);

	function handleRealtimeUpdate() {
		// Invalidate all data to refresh from server
		// This ensures we get the latest state including dependency validation
		invalidateAll();
	}

	// Realtime updates without live cursor payloads
	onMount(() => {
		if (modlist?.id) {
			unsubscribeRealtime = subscribeToModlistUpdates(modlist.id, handleRealtimeUpdate);

			const url = `/api/modlists/${modlist.id}/events`;
			eventSource = new EventSource(url);

			eventSource.onmessage = (ev) => {
				try {
					const payload = JSON.parse(ev.data);
					if (payload.type !== 'ping') {
						handleRealtimeUpdate();
					}
				} catch {
					handleRealtimeUpdate();
				}
			};
		}
	});

	onDestroy(() => {
		if (unsubscribeRealtime) {
			unsubscribeRealtime();
		}
		eventSource?.close();
	});

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

	async function copyExportCommand() {
		if (!modlist?.id) return;
		const cookieName = 'auth-session';
		const cmd = `curl -H "Cookie: ${cookieName}=${sessionToken}" -sL "${location.origin}/api/modlists/${modlist.id}/export" | bash`;
		try {
			await navigator.clipboard.writeText(cmd);
			exportCopied = true;
			setTimeout(() => {
				exportCopied = false;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy export command', err);
		}
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
					<!-- Share Dialog -->
					<Dialog.Root bind:open={shareDialogOpen}>
						<Dialog.Trigger>
							<Button type="button" variant="outline" size="sm">
								<ShareIcon class="mr-2 h-4 w-4" />
								Share
							</Button>
						</Dialog.Trigger>

						<Dialog.Content class="w-[400px] p-6">
							<Dialog.Header>
								<Dialog.Title>Share Modlist</Dialog.Title>
							</Dialog.Header>

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
										<Button
											variant="destructive"
											size="sm"
											onclick={() => removeCollaborator(c.id)}
										>
											Remove
										</Button>
									</div>
								{/each}
							</div>

							<Dialog.Footer class="mt-4 text-right">
								<Dialog.Close>
									<Button variant="outline" size="sm">Close</Button>
								</Dialog.Close>
							</Dialog.Footer>
						</Dialog.Content>
					</Dialog.Root>

					<!-- Export Button: copies command to clipboard -->
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={copyExportCommand}
						class={exportCopied ? 'animate-pulse' : ''}
					>
						<DownloadIcon class="mr-2 h-4 w-4" />
						<span class="inline-block w-34 text-left">
							{exportCopied ? 'Copied!' : 'Copy Export Command'}
						</span>
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
