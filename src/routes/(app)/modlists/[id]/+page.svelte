<script lang="ts">
	import type { PageProps } from './$types';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import ModSearchSidebar from './ModSearchSidebar.svelte';
	import ModSearchResults from './ModSearchResults.svelte';
	import ModTable from './ModTable.svelte';
	import CredentialsWarning from './CredentialsWarning.svelte';
	import EditableModlistName from './EditableModlistName.svelte';
	import DependencyValidation from './DependencyValidation.svelte';
	import { enhance } from '$app/forms';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { DownloadIcon, ShareIcon, TrashIcon } from '@lucide/svelte';
	import { realtimeManager } from '$lib/stores/realtime.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Portal } from 'bits-ui';
	import type { Mod } from '$lib/server/db/schema';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	let { data }: PageProps = $props();
	let modlist = $derived(data.modlist);
	let mods = $derived(data.mods);
	let iceboxMods = $derived(data.iceboxMods as Array<Mod>);
	let collaborators = $derived(data.collaborators);
	let currentUserId = $derived(data.currentUserId);
	let hasCredentials = $derived(data.hasFactorioCredentials);
	let searchResults = $derived(data.searchResults);
	let searchQuery = $derived(data.searchQuery);
	let searchError = $derived(data.searchError);
	let dependencyValidation = $derived(data.dependencyValidation);
	let currentPage = $derived(data.currentPage);
	let totalPages = $derived(data.totalPages);

	let showDeleteConfirm = $state(false);
	let unsubscribeRealtime: (() => void) | null = null;
	let shareDialogOpen = $state(false);
	let shareError = $state('');
	let shareUsername = $state('');
	let eventSource: EventSource | null = null;
	let sessionToken = $derived(data.sessionToken);
	let exportCopied = $state(false);

	// Public read-only sharing state
	let isPublicRead = $derived(modlist?.publicRead ?? false);

	// Determine if the current user is the owner or a collaborator
	let isCollaborator = $derived(
		modlist?.owner === currentUserId ||
			(collaborators?.some((c) => c.id === currentUserId) ?? false)
	);

	type Viewer = {
		id: string;
		username: string;
	};

	let activeViewers = $state<Viewer[]>([]);

	function handleRealtimeUpdate(
		eventType?: string,
		eventData?: { modId?: string; enabled?: boolean; essential?: boolean; name?: string } | null
	) {
		// Optimized: only update the specific changes instead of full page reload
		if (eventType === 'mod-toggled' && eventData?.modId && eventData?.enabled !== undefined) {
			const modIndex = mods.findIndex((m) => m.id === eventData.modId);
			if (modIndex !== -1) {
				mods[modIndex] = { ...mods[modIndex], enabled: eventData.enabled };
				mods = [...mods];
				return;
			}
		} else if (
			eventType === 'mod-essential-toggled' &&
			eventData?.modId &&
			eventData?.essential !== undefined
		) {
			const modIndex = mods.findIndex((m) => m.id === eventData.modId);
			if (modIndex !== -1) {
				mods[modIndex] = { ...mods[modIndex], essential: eventData.essential };
				mods = [...mods];
				return;
			}
		} else if (eventType === 'icebox-activated' && eventData?.modId) {
			const modIndex = mods.findIndex((m) => m.id === eventData.modId);
			if (modIndex !== -1) {
				mods[modIndex] = { ...mods[modIndex], icebox: false };
				mods = [...mods];
				return;
			}
		} else if (eventType === 'mod-moved-to-icebox' && eventData?.modId) {
			const modIndex = mods.findIndex((m) => m.id === eventData.modId);
			if (modIndex !== -1) {
				mods[modIndex] = { ...mods[modIndex], icebox: true };
				mods = [...mods];
				return;
			}
		} else if (eventType === 'mod-removed' && eventData?.name) {
			const modIndex = mods.findIndex((m) => m.name === eventData.name);
			if (modIndex !== -1) {
				mods.splice(modIndex, 1);
				mods = [...mods];
				return;
			}
		} else if (eventType === 'mod-added' && eventData?.name) {
			// For mod-added, we need fresh data from server since we don't have full mod object
			// But we can show optimistic update
			const tempMod = {
				id: `temp-${Date.now()}`,
				name: eventData.name,
				enabled: true,
				icebox: false,
				essential: false,
				// Other properties will be filled when cache is updated
				title: eventData.name,
				summary: null,
				description: null,
				category: null,
				tags: null,
				thumbnail: null,
				downloadsCount: null,
				lastUpdated: null,
				version: null,
				factorioVersion: null,
				dependencies: null,
				lastFetched: null,
				fetchError: null,
				updatedBy: null,
				modlist: modlist?.id || ''
			};
			mods = [...mods, tempMod];
			// Schedule a proper refresh after a short delay to get real data
			setTimeout(() => invalidateAll(), 2000);
			return;
		} else if (eventType === 'icebox-added' && eventData?.name) {
			// Similar optimistic update for icebox
			const tempMod = {
				id: `temp-icebox-${Date.now()}`,
				name: eventData.name,
				enabled: false,
				icebox: true,
				essential: false,
				title: eventData.name,
				summary: null,
				description: null,
				category: null,
				tags: null,
				thumbnail: null,
				downloadsCount: null,
				lastUpdated: null,
				version: null,
				factorioVersion: null,
				dependencies: null,
				lastFetched: null,
				fetchError: null,
				updatedBy: null,
				modlist: modlist?.id || ''
			};
			mods = [...mods, tempMod];
			setTimeout(() => invalidateAll(), 2000);
			return;
		}

		// Fallback to full reload for other types of updates
		invalidateAll();
	}

	// Realtime updates without live cursor payloads
	onMount(() => {
		if (modlist?.id) {
			// Subscribe to individual event types with specific handlers
			const unsubscribers = [
				realtimeManager.subscribe(`mod-toggled:${modlist.id}`, (data) =>
					handleRealtimeUpdate('mod-toggled', data)
				),
				realtimeManager.subscribe(`mod-essential-toggled:${modlist.id}`, (data) =>
					handleRealtimeUpdate('mod-essential-toggled', data)
				),
				realtimeManager.subscribe(`modlist-updated:${modlist.id}`, (data) =>
					handleRealtimeUpdate('modlist-updated', data)
				),
				realtimeManager.subscribe(`mod-added:${modlist.id}`, (data) =>
					handleRealtimeUpdate('mod-added', data)
				),
				realtimeManager.subscribe(`mod-removed:${modlist.id}`, (data) =>
					handleRealtimeUpdate('mod-removed', data)
				),
				realtimeManager.subscribe(`modlist-name-updated:${modlist.id}`, (data) =>
					handleRealtimeUpdate('modlist-name-updated', data)
				),
				realtimeManager.subscribe(`icebox-added:${modlist.id}`, (data) =>
					handleRealtimeUpdate('icebox-added', data)
				),
				realtimeManager.subscribe(`icebox-activated:${modlist.id}`, (data) =>
					handleRealtimeUpdate('icebox-activated', data)
				),
				realtimeManager.subscribe(`mod-moved-to-icebox:${modlist.id}`, (data) =>
					handleRealtimeUpdate('mod-moved-to-icebox', data)
				)
			];

			unsubscribeRealtime = () => {
				unsubscribers.forEach((unsub) => unsub());
			};

			const url = `/api/modlists/${modlist.id}/events`;
			eventSource = new EventSource(url);

			eventSource.onmessage = (ev) => {
				try {
					const payload = JSON.parse(ev.data);
					if (payload.type === 'presence-update' || payload.type === 'presence-init') {
						activeViewers = payload.data.viewers || [];
					} else if (payload.type !== 'ping') {
						handleRealtimeUpdate(payload.type, payload.data);
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

	function removeCollaborator(userId: string) {
		// Create and submit a form for removing collaborator
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = '?/shareRemove';

		const input = document.createElement('input');
		input.type = 'hidden';
		input.name = 'userId';
		input.value = userId;

		form.appendChild(input);
		document.body.appendChild(form);
		form.submit();
		document.body.removeChild(form);
	}

	async function copyDownloadCommand() {
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
			console.error('Failed to copy download command', err);
		}
	}

	async function copyModlistJson() {
		// Build a minimal mod-list.json with enabled mods only
		if (!mods) return;
		try {
			const enabledMods = (mods as Mod[]).filter((m) => m.enabled);
			const json = JSON.stringify(
				{
					mods: [
						{ name: 'base', enabled: true },
						...enabledMods.map((m) => ({ name: m.name, enabled: true }))
					]
				},
				null,
				2
			);
			await navigator.clipboard.writeText(json);
			exportCopied = true;
			setTimeout(() => {
				exportCopied = false;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy mod-list.json', err);
		}
	}
</script>

<svelte:head>
	<title>{modlist?.name ? `${modlist.name} - Facmandu` : 'Facmandu'}</title>
</svelte:head>

<Sidebar.Provider cookieName="sidebar:filters" keyboardShortcut="g" style="--sidebar-width: 620px;">
	<Portal to="#page-header">
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<EditableModlistName name={modlist?.name || ''} modlistId={modlist?.id || ''} />

				{#if activeViewers.length && isCollaborator}
					<div class="text-muted-foreground flex items-center gap-1 text-xs">
						<span>Viewing:</span>
						{#each activeViewers as viewer (viewer.id)}
							<span class="text-foreground font-medium">{viewer.username}</span>
						{/each}
					</div>
				{/if}
			</div>
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

								<form
									id="share-form"
									method="POST"
									action="?/shareAdd"
									class="mb-4 flex gap-2"
									use:enhance={() => {
										shareError = '';
										return async ({ result }) => {
											if (result.type === 'success') {
												shareUsername = '';
												await invalidateAll();
											} else if (result.type === 'failure') {
												shareError =
													(result.data as { message?: string })?.message || 'Failed to share';
											}
										};
									}}
								>
									<input
										name="username"
										class="flex-1 rounded-sm border bg-transparent px-2 py-1"
										placeholder="Username"
										bind:value={shareUsername}
										required
									/>
									<Button type="submit" size="sm">Add</Button>
								</form>

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

								<!-- Public read-only toggle -->
								<form
									method="POST"
									action="?/sharePublic"
									use:enhance
									class="mt-4 flex items-center gap-2"
								>
									<input
										id="public-read"
										type="checkbox"
										name="enabled"
										value="true"
										bind:checked={isPublicRead}
									/>
									<label for="public-read" class="flex-1 text-sm"
										>Make modlist public (read-only)</label
									>
									<Button size="sm" type="submit">Save</Button>
								</form>

								<Dialog.Footer class="mt-4 text-right">
									<Dialog.Close>
										<Button variant="outline" size="sm">Close</Button>
									</Dialog.Close>
								</Dialog.Footer>
							</Dialog.Content>
						</Dialog.Root>

						<!-- Export dropdown -->
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class={buttonVariants({ variant: 'outline', size: 'sm' }) +
									(exportCopied ? ' animate-pulse' : '')}
							>
								<DownloadIcon class="mr-2 h-4 w-4" />
								Export
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item onclick={copyModlistJson}>Copy mod-list.json</DropdownMenu.Item>
								<DropdownMenu.Item onclick={copyDownloadCommand}
									>Copy download script</DropdownMenu.Item
								>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

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

					<Sidebar.Trigger variant="ghost" size="sm" flipped>Filters</Sidebar.Trigger>
				{/if}
			</div>
		</div>
	</Portal>

	<div class="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-1 flex-col gap-4 px-4 py-4">
		<DependencyValidation {dependencyValidation} {mods} />

		<ModTable
			{mods}
			{iceboxMods}
			modlistName={modlist?.name || ''}
			conflictingMods={[
				...new Set(dependencyValidation.conflicts.flatMap((c) => [c.mod, c.conflictsWith]))
			]}
		/>
	</div>

	<!-- Right sidebar for improved mod search/filter -->
	<Sidebar.Root
		side="right"
		collapsible="offcanvas"
		style="top: var(--header-height); height: calc(100svh - var(--header-height));"
	>
		<Sidebar.Content class="flex h-full flex-col gap-4 overflow-y-auto border-l p-4">
			<ModSearchSidebar {searchQuery} {searchError} />

			{#if hasCredentials}
				<ModSearchResults
					{searchResults}
					currentMods={[...mods, ...iceboxMods]}
					{currentPage}
					{totalPages}
				/>
			{:else}
				<CredentialsWarning />
			{/if}
		</Sidebar.Content>
	</Sidebar.Root>
</Sidebar.Provider>
