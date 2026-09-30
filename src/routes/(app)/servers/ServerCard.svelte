<script lang="ts">
 import type { ServerView } from '$lib/server/server-view';
 import { watchServerStatus } from '$lib/server-status';
 import { ChevronRightIcon, LibraryIcon } from '@lucide/svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import InstanceSettings from './[serverId]/InstanceSettings.svelte';
 import type { ServerSummary } from '$lib/server/servers';
 let { server, listName, reviewListId }: { server:ServerSummary; listName?:string; reviewListId:string|null } = $props();
 let status = $state<ServerView['status'] | null>(null);
 let unavailable = $state(false);
 const href = $derived(`/servers/${server.id}${reviewListId ? `?tab=mods&list=${encodeURIComponent(reviewListId)}` : ''}`);
 const statusLabel = $derived(unavailable ? 'Unavailable' : status ? status.stopping ? 'Stopping…' : status.failed ? 'Failed to start' : status.running ? 'Running' : 'Stopped' : 'Checking…');
 $effect(()=>watchServerStatus(server.id,value=>{status=value;unavailable=false;},()=>{unavailable=true;}));
</script>
<li class="collection-row">
 <a {href} class="collection-link"><h2 class="break-words font-semibold">{server.name}</h2>
  <p class="text-muted-foreground mt-0.5 flex items-center gap-1.5 break-words text-xs"><LibraryIcon class="size-3 shrink-0" />{listName ?? 'No mod list'}</p>
  <p class="text-muted-foreground mt-1 text-xs md:hidden">{status?.version.version ? `Factorio ${status.version.version} · ` : ''}{statusLabel}</p>
 </a>
 <span class="text-muted-foreground hidden text-sm tabular-nums md:block">{status?.version.version || '—'}</span>
 <span class="hidden items-center gap-2 text-sm md:flex"><span class={`status-light ${status?.failed && !unavailable ? '!bg-red-400' : ''} ${status?.running && !status.stopping && !unavailable ? 'is-running' : ''} ${unavailable || status?.stopping ? 'is-unavailable' : ''}`}></span>{statusLabel}</span>
 <div class="flex items-center justify-end gap-1"><InstanceSettings {server} /><TooltipButton {href} tooltip={reviewListId ? 'Review mod list' : 'Open server'} aria-label={reviewListId ? `Review mod list on ${server.name}` : `Open ${server.name}`} variant="ghost" size="icon"><ChevronRightIcon class="size-4" /></TooltipButton></div>
</li>
