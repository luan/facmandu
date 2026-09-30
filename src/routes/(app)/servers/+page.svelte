<script lang="ts">
 import ListPage from '$lib/components/ListPage.svelte';
 import ServerCard from './ServerCard.svelte';
 import type { PageProps } from './$types';
 let { data }: PageProps = $props();
 let query = $state('');
 const listName = (id:string|null) => data.modLists.find(list=>list.id===id)?.name;
 const servers = $derived(data.servers.filter(server=>`${server.name} ${listName(server.selectedModlist) ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
</script>
<svelte:head><title>Servers · Facmandu</title></svelte:head>
{#snippet selection()}Select a server for {data.modLists.find(list=>list.id===data.reviewListId)?.name ?? 'this mod list'}.{/snippet}
<ListPage context={data.reviewListId ? selection : undefined} title="Servers" createHref="/servers/new" createLabel="Create server" searchLabel="Find servers" bind:query columns={['Server','Factorio','Status']} empty={!data.servers.length} emptyMessage="No servers yet.">
 {#each servers as server (server.id)}<ServerCard {server} reviewListId={data.reviewListId} listName={listName(server.selectedModlist)} />{:else}<li class="p-4 text-sm text-muted-foreground">No matching servers.</li>{/each}
</ListPage>
