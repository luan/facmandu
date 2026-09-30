<script lang="ts">
 import { toast } from 'svelte-sonner';
	import { ServerIcon, CopyIcon, UsersIcon, LoaderCircleIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import ListPage from '$lib/components/ListPage.svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';

	let { data }: import('./$types').PageProps = $props();
	let copying = $state<string | null>(null);
 let query = $state('');
 const lists = $derived(data.modLists.filter(list => `${list.name} ${list.collaborators.map(person => person.username).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
	
</script>
<svelte:head><title>Mod library · Facmandu</title></svelte:head>

<ListPage title="Mod library" createHref="/modlists/new" createLabel="Create list" searchLabel="Find lists" bind:query columns={['List','Factorio','Enabled mods']} empty={!data.modLists.length} emptyMessage="No mod lists yet.">
 {#each lists as list (list.id)}
				<li class="collection-row">
					<a href={`/modlists/${list.id}`} class="collection-link"><h2 class="break-words font-semibold">{list.name}</h2>
						{#if list.collaborators?.length}<p class="text-muted-foreground mt-0.5 flex items-center gap-1.5 break-words text-xs"><UsersIcon class="size-3 shrink-0" /><span class="sr-only">Shared with </span>{list.collaborators.map((collaborator) => collaborator.username).join(', ')}</p>{/if}
						<p class="text-muted-foreground mt-1 text-xs md:hidden">Factorio {list.factorioVersion} · {list.enabledCount} / {list.totalMods} enabled</p>
					</a>
					<span class="text-muted-foreground hidden text-sm tabular-nums md:block">{list.factorioVersion}</span>
					<span class="hidden text-sm tabular-nums md:block">{list.enabledCount}<span class="text-muted-foreground"> / {list.totalMods}</span></span>
					<div class="flex items-center justify-end gap-1">
							{#if data.canManageServer}<TooltipButton href={`/servers?list=${list.id}`} tooltip="Apply to server" aria-label={`Apply ${list.name} to a server`} variant="ghost" size="icon"><ServerIcon class="size-4" /></TooltipButton>{/if}
							<form method="POST" action="?/duplicate" use:enhance={({cancel}) => {
								if (copying) { cancel(); return; }
								copying = list.id; 
								return async ({ update, result }) => {
									try {
										if (result.type === 'error') toast.error('Could not duplicate this list. Try again.');
										else await update();
									} finally { copying = null; }
								};
							}}><input type="hidden" name="modlistId" value={list.id} /><TooltipButton type="submit" tooltip={copying === list.id ? 'Duplicating…' : 'Duplicate'} aria-label={`Duplicate ${list.name}`} variant="ghost" size="icon" disabled={copying !== null}>{#if copying === list.id}<LoaderCircleIcon class="size-4 animate-spin" />{:else}<CopyIcon class="size-4" />{/if}</TooltipButton></form>
						</div>
				</li>
			{:else}<li class="p-4 text-sm text-muted-foreground">No matching lists.</li>{/each}
			</ListPage>
