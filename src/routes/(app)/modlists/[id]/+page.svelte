<script lang="ts">
 import ModlistAssistant from './ModlistAssistant.svelte';
 import RecommendationSheet from './RecommendationSheet.svelte';
 import IceboxSheet from './IceboxSheet.svelte';
	import { ChevronDownIcon, BookIcon, PackageIcon, LoaderCircleIcon, TrashIcon, XIcon, SearchIcon, PlusIcon, SaveIcon, RefreshCwIcon, ServerIcon, EllipsisIcon, Share2Icon, CopyIcon, DownloadIcon } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { PageProps } from './$types';
	import * as Sheet from '$lib/components/ui/sheet';
	import ModSearchSidebar from './ModSearchSidebar.svelte';
	import ModSearchResults from './ModSearchResults.svelte';
	import ModTable from './ModTable.svelte';
	import CredentialsWarning from './CredentialsWarning.svelte';
	import EditableModlistName from './EditableModlistName.svelte';
	import DependencyValidation from './DependencyValidation.svelte';
	import { enhance, deserialize } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { invalidate, goto } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog';
	import { createModList } from '$lib/mod-list';
	import type { RepairProgress } from '$lib/server/modlist-repair';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	let { data }: PageProps = $props();
	let modlist = $derived(data.modlist);
	const modlistId = $derived(data.modlist.id);
	let mods = $derived(data.mods);
	let iceboxMods = $derived(data.iceboxMods);
	let collaborators = $derived(data.collaborators);
	let currentUserId = $derived(data.currentUserId);
	let hasCredentials = $derived(data.hasFactorioCredentials);
	let dependencyValidation = $derived(data.dependencyValidation);

	let showDeleteConfirm = $state(false);
	let shareDialogOpen = $state(false);
	let shareError = $state('');
	let shareUsername = $state('');
	let exportCopied = $state(false);
	let searchOpen = $state(false);
 let recommendationsOpen = $state(false);
 let iceboxOpen = $state(false);
 let refreshForm = $state<HTMLFormElement>();
	let repair = $state<RepairProgress | null>(null);
	let repairError = $state('');
	let repairAttempt = $state(0);
	let pending = $state(false);
	const submitListAction: SubmitFunction = ({ cancel, formElement }) => {
		if (pending) { cancel(); return; }
		pending = true; shareError = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure' || result.type === 'error') {
					const message = result.type === 'failure' ? String(result.data?.message || 'Could not save this change') : 'Could not reach the app. Try again.';
					if (shareDialogOpen) shareError = message;
					else toast.error(message);
					isPublicRead = modlist.publicRead ?? false;
					const version = formElement.elements.namedItem('version');
					if (version instanceof HTMLSelectElement) version.value = modlist.factorioVersion;
					return;
				}
				await update({ reset: false });
				if (formElement.id === 'share-form') shareUsername = '';
			} finally { pending = false; }
		};
	};

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
	const otherViewers = $derived(activeViewers.filter((viewer) => viewer.id !== currentUserId));

	$effect(() => {
		const id = modlistId;
		const writable = isCollaborator;
		void repairAttempt;
		repairError = '';
		repair = untrack(() => data.repair);
		const controller = new AbortController();
		const endpoint = `/api/modlists/${id}/repair`;
		let refreshTimer: ReturnType<typeof setTimeout> | undefined;
		let checking = false;
		const refresh = () => {
			refreshTimer ??= setTimeout(() => { refreshTimer = undefined; void invalidate('app:modlist'); }, 100);
		};
		const acceptProgress = (value: RepairProgress | null) => {
			if (controller.signal.aborted || !value) return;
			const wasRunning = repair?.state === 'running';
			repair = value;
			if (wasRunning && value.state !== 'running') refresh();
		};
		const events = new EventSource(`/api/modlists/${id}/events`);
		events.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data);
				if (payload.type === 'presence-update' || payload.type === 'presence-init') activeViewers = payload.data.viewers ?? [];
				else if (payload.type === 'repair-progress') acceptProgress(payload.data);
				else if (payload.type !== 'ping') refresh();
			} catch { refresh(); }
		};
		if (writable) {
			void fetch(endpoint, { method: 'POST', signal: controller.signal }).then((response) => {
				if (!response.ok) throw new Error('Could not start automatic repair.');
				return response.json();
			}).then(acceptProgress).catch(() => { if (!controller.signal.aborted) repairError = 'Automatic repair could not start. Your list is saved; retry when the connection is available.'; });
		}
		const poll = setInterval(async () => {
			if (!writable || repair?.state !== 'running' || checking) return;
			checking = true;
			try {
				const response = await fetch(endpoint, { signal: controller.signal });
				if (!response.ok) throw new Error('Could not check repair progress');
				const value: RepairProgress | null = await response.json();
				if (value) acceptProgress(value);
				else acceptProgress(await (await fetch(endpoint, { method: 'POST', signal: controller.signal })).json());
			} catch { /* SSE continues independently; retry on the next progress check. */ }
			finally { checking = false; }
		}, 2000);
		return () => { controller.abort(); events.close(); clearInterval(poll); clearTimeout(refreshTimer); };
	});

	async function removeCollaborator(userId: string) {
		if (pending) return;
		pending = true; shareError = '';
		const fields = new FormData(); fields.set('userId', userId);
		try {
			const response = await fetch('?/shareRemove', { method: 'POST', headers: { 'x-sveltekit-action': 'true' }, body: fields });
			const result = deserialize(await response.text());
			if (result.type === 'success') await invalidate('app:modlist');
			else shareError = 'Could not remove collaborator';
		} catch { shareError = 'Could not remove collaborator'; }
		finally { pending = false; }
	}

	let exporting = $state(false);
	async function downloadBundle() {
		if (exporting) return;
		exporting = true;
		try {
			const response = await fetch(`/api/modlists/${modlistId}/export`, { method: 'POST' });
			const result = await response.json();
			if (!response.ok) throw new Error(result.message || 'Could not prepare mod bundle');
			toast.success(result.state === 'done' ? 'Your mod bundle is ready in Activity.' : 'Preparing your mod bundle. Progress and the download will appear in Activity.');
		} catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not prepare mod bundle'); }
		finally { exporting = false; }
	}

	async function copyModlistJson() {
		try {
			const json = JSON.stringify(createModList(mods), null, 2);
			await navigator.clipboard.writeText(json);
			exportCopied = true;
			setTimeout(() => {
				exportCopied = false;
			}, 2000);
		} catch {
			toast.error('Could not copy the mod list. Check clipboard access and try again.');
		}
	}
</script>

<svelte:head>
	<title>{modlist?.name ? `${modlist.name} - Facmandu` : 'Facmandu'}</title>
</svelte:head>

	<div class="workbench">
	<section class="factory-panel">
		<header class="window-title border-0 shadow-none flex flex-wrap items-center justify-between gap-4">
			<div class="min-w-0 space-y-1">
				<a href="/modlists" class="text-muted-foreground text-sm">Mod library</a>
				<div class="flex flex-wrap items-center gap-x-6 gap-y-2"><EditableModlistName name={modlist?.name || ''} disabled={modlist?.owner !== currentUserId} /><form method="POST" action="?/setFactorioVersion" use:enhance={submitListAction} class="flex items-center gap-2 text-sm">
				<label for="list-factorio-version" class="text-muted-foreground">Factorio</label>
				<select id="list-factorio-version" name="version" value={modlist.factorioVersion} disabled={!isCollaborator || pending} onchange={(event) => event.currentTarget.form?.requestSubmit()} class="bg-background rounded border px-2 py-1">
					{#each [...new Set([modlist.factorioVersion, '2.1', '2.0', '1.1', '1.0'])] as version}<option value={version}>{version}</option>{/each}
				</select>
			</form></div>

                <div class="flex min-h-6 flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
                    <span>{mods.filter((mod) => mod.enabled).length} enabled · {mods.filter((mod) => !mod.enabled).length} disabled</span>
                    {#if pending && !shareDialogOpen}<span role="status" class="inline-flex items-center gap-1.5"><LoaderCircleIcon class="size-3.5 animate-spin" />Saving…</span>
                    {:else if repair?.state === 'running'}<span role="status" class="inline-flex items-center gap-1.5"><LoaderCircleIcon class="size-3.5 animate-spin" />Checking mods…</span>{/if}
                </div>
				{#if otherViewers.length && isCollaborator}
					<div class="text-muted-foreground flex items-center gap-1 text-xs">
						<span>Viewing:</span>
						{#each otherViewers as viewer (viewer.id)}
							<span class="text-foreground font-medium">{viewer.username}</span>
						{/each}
					</div>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if showDeleteConfirm}
					<div class="flex items-center gap-2">
						<span class="text-muted-foreground text-sm">Are you sure?</span>
						<form method="POST" action="?/deleteModlist" use:enhance={submitListAction}>
							<Button type="submit" variant="destructive" size="sm" disabled={pending}><TrashIcon class="size-4" />{pending ? 'Deleting…' : 'Delete'}</Button>
						</form>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() => (showDeleteConfirm = false)}
						><XIcon class="size-4" />
							Cancel
						</Button>
					</div>
				{:else}
					{#if isCollaborator}{#key modlistId}<ModlistAssistant listId={modlistId} />{/key}{/if}
					<div class="flex items-stretch gap-px">
                        <Button size="sm" onclick={() => (searchOpen = true)}><SearchIcon class="size-4" />{isCollaborator ? 'Add mods' : 'Browse mods'}</Button>
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger aria-label="Mod sources" class={`${buttonVariants({size:'sm'})} px-2`}><ChevronDownIcon class="size-4" /></DropdownMenu.Trigger>
                            <DropdownMenu.Content align="end">
                                {#if isCollaborator}<DropdownMenu.Item onSelect={() => (recommendationsOpen = true)}><BookIcon class="size-4" />Recommendations</DropdownMenu.Item>{/if}
                                <DropdownMenu.Item onSelect={() => (iceboxOpen = true)}><PackageIcon class="size-4" />Icebox ({iceboxMods.length})</DropdownMenu.Item>
                            </DropdownMenu.Content>
                        </DropdownMenu.Root>
                    </div>
					{#if modlist?.owner === currentUserId}
						<Dialog.Root bind:open={shareDialogOpen}>
							<Dialog.Content class="w-[400px] p-6">
								<Dialog.Header>
									<Dialog.Title>Share Modlist</Dialog.Title>
									<Dialog.Description>Invite collaborators to edit this list, or share a public link with read-only access.</Dialog.Description>
								</Dialog.Header>

								{#if shareError}
									<p role="alert" class="text-destructive mb-2">{shareError}</p>
								{/if}

								<form
									id="share-form"
									method="POST"
									action="?/shareAdd"
									class="mb-4 flex gap-2"
									use:enhance={submitListAction}
								>
									<input
										name="username"
										class="min-w-0 flex-1 rounded-sm border bg-transparent px-2 py-1"
										placeholder="Username"
										aria-label="Collaborator username"
										disabled={pending}
										bind:value={shareUsername}
										required
									/>
									<Button type="submit" size="sm" disabled={pending}><PlusIcon class="size-4" />Add</Button>
								</form>

								<div class="max-h-40 space-y-2 overflow-y-auto">
									{#each collaborators as c (c.id)}
										<div class="flex items-center justify-between">
											<span>{c.username}</span>
											<Button
												variant="destructive"
												size="sm"
												onclick={() => removeCollaborator(c.id)}
												disabled={pending}
											><TrashIcon class="size-4" />
												Remove
											</Button>
										</div>
									{/each}
								</div>

								<!-- Public read-only toggle -->
								<form
									method="POST"
									action="?/sharePublic"
									use:enhance={submitListAction}
									class="mt-4 flex items-center gap-2"
								>
									<input
										id="public-read"
										type="checkbox"
										name="enabled"
										value="true"
										bind:checked={isPublicRead}
										disabled={pending}
									/>
									<label for="public-read" class="flex-1 text-sm"
										>Make modlist public (read-only)</label
									>
									<Button size="sm" type="submit" disabled={pending}><SaveIcon class="size-4" />Save</Button>
								</form>

								<Dialog.Footer class="mt-4 text-right">
									<Dialog.Close class={buttonVariants({ variant: 'outline', size: 'sm' })}><XIcon class="size-4" />Close</Dialog.Close>
								</Dialog.Footer>
							</Dialog.Content>
						</Dialog.Root>
					{/if}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger class={buttonVariants({ variant: 'outline', size: 'sm' }) + (exportCopied ? ' animate-pulse' : '')}><EllipsisIcon class="size-4" />More</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
                                {#if data.canManageServer && isCollaborator}<DropdownMenu.Item onSelect={() => goto(`/servers?list=${encodeURIComponent(modlistId)}`)}><ServerIcon class="size-4" />Apply to server…</DropdownMenu.Item>{/if}
                                {#if isCollaborator}<DropdownMenu.Item disabled={pending || repair?.state === 'running'} onSelect={() => refreshForm?.requestSubmit()}><RefreshCwIcon class="size-4" />Update mods</DropdownMenu.Item><DropdownMenu.Separator />{/if}
								{#if modlist?.owner === currentUserId}<DropdownMenu.Item onSelect={() => (shareDialogOpen = true)}><Share2Icon class="size-4" />Share list</DropdownMenu.Item>{/if}
								<DropdownMenu.Item onSelect={copyModlistJson}><CopyIcon class="size-4" />Copy mod-list.json</DropdownMenu.Item>
								{#if isCollaborator}<DropdownMenu.Item onSelect={downloadBundle} disabled={exporting}><DownloadIcon class="size-4" />{exporting ? 'Preparing…' : 'Download mods (.tar.gz)'}</DropdownMenu.Item>{/if}
								{#if modlist?.owner === currentUserId}<DropdownMenu.Item onSelect={() => (showDeleteConfirm = true)}><TrashIcon class="size-4" />Delete list…</DropdownMenu.Item>{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
				{/if}
			</div>
		</header>
		{#if repairError}<div role="alert" class="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 p-3 text-sm"><p>{repairError}</p><Button variant="outline" size="sm" onclick={() => repairAttempt++}><RefreshCwIcon class="size-4" />Retry repair</Button></div>{/if}
		{#if repair?.state === 'error' && !repairError}
			<div role="alert" class="flex items-center gap-3 border-b px-4 py-3 text-sm"><p>Could not finish checking mods.</p><Button variant="outline" size="sm" onclick={() => repairAttempt++}><RefreshCwIcon class="size-4" />Retry</Button></div>
		{/if}

		<DependencyValidation {dependencyValidation} {mods} factorioVersion={modlist.factorioVersion} readOnly={!isCollaborator} />

		{#key `${modlistId}:${modlist.factorioVersion}`}
			<ModTable factorioVersion={modlist.factorioVersion}
				{mods}
				readOnly={!isCollaborator}
			conflictingMods={[
				...new Set(dependencyValidation.conflicts.flatMap((c) => [c.mod, c.conflictsWith]))
			]}
		/>
		{/key}
	</section>
	</div>

	<!-- Search overlays the list so its columns stay readable. -->
	<Sheet.Root bind:open={searchOpen}>
		<Sheet.Content side="right" class="w-full p-0 sm:max-w-[620px]">
			<Sheet.Header class="border-b px-5 py-4">
				<Sheet.Title>Find mods</Sheet.Title>
				<Sheet.Description>Search the Factorio mod portal and add mods to this list.</Sheet.Description>
			</Sheet.Header>
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
			<ModSearchSidebar factorioVersion={modlist.factorioVersion} />

			{#if hasCredentials}
					<ModSearchResults
						readOnly={!isCollaborator}
					currentMods={[...mods, ...iceboxMods]}
				/>
			{:else}
				<CredentialsWarning />
			{/if}
			</div>
		</Sheet.Content>
	</Sheet.Root>

{#key modlistId}
    {#if isCollaborator}
        <form bind:this={refreshForm} method="POST" action="?/refreshAllMods" use:enhance={submitListAction} hidden></form>
        <RecommendationSheet bind:open={recommendationsOpen} {mods} {modlistId} factorioVersion={modlist.factorioVersion} curationAvailable={data.curationAvailable} canEdit={isCollaborator} />
    {/if}
    <IceboxSheet bind:open={iceboxOpen} {iceboxMods} factorioVersion={modlist.factorioVersion} readOnly={!isCollaborator} />
{/key}
