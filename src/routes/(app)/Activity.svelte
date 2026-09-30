<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { invalidate } from '$app/navigation';
	import { ActivityIcon, LoaderCircleIcon } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { buttonVariants } from '$lib/components/ui/button';
	import { getActivityState } from '$lib/activity.svelte';
	import type { Activity } from '$lib/server/activity';
	let { servers, lists }: { servers: { id: string; name: string }[]; lists: { id: string; name: string }[] } = $props();
	let open = $state(false);
	const activityState = getActivityState();
	const running = $derived(activityState.items.filter((activity) => activity.state === 'running').length);
	const issues = $derived(activityState.items.filter((activity) => activity.state === 'error').length);
	const ordered = $derived(activityState.items.toSorted((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || b.updatedAt - a.updatedAt).slice(0, 10));
	const permissions = $derived([...servers.map((item) => `server:${item.id}`), ...lists.map((item) => `modlist:${item.id}`)]);
	$effect(() => {
		const allowed = new Set(permissions);
		if (!browser) return;
		activityState.items = untrack(() => activityState.items.filter((activity) => allowed.has(`${activity.scope}:${activity.targetId}`)));
		const events = new EventSource('/api/activity');
		events.addEventListener('permissions', (event) => {
			const { removed } = JSON.parse(event.data) as { removed: string };
			activityState.items = activityState.items.filter((item) => item.scope !== 'modlist' || item.targetId !== removed);
			void invalidate('app:library');
		});
		events.onmessage = (event) => {
			try { const activity: Activity = JSON.parse(event.data); activityState.items = [...activityState.items.filter((item) => item.key !== activity.key), activity].slice(-100); }
			catch { /* The next event carries a complete progress snapshot. */ }
		};
		return () => events.close();
	});
</script>
<Sheet.Root bind:open>
 <Sheet.Trigger class={buttonVariants({variant: 'ghost', size: 'sm'})} aria-label={`Background activity${running ? `: ${running} running` : issues ? `: ${issues} need attention` : ''}`}>
  {#if running}<LoaderCircleIcon class="size-4 animate-spin" /><span>{running}</span>{:else}<ActivityIcon class="size-4" />{#if issues}<span class="text-amber-500">{issues}</span>{/if}{/if}
  <span class="hidden md:inline">Activity</span>
 </Sheet.Trigger>
 <Sheet.Content class="w-full sm:max-w-md">
  <Sheet.Header><Sheet.Title>Background activity</Sheet.Title><Sheet.Description>{running ? `${running} task${running === 1 ? '' : 's'} running` : issues ? `${issues} task${issues === 1 ? ' needs' : 's need'} attention` : 'Recent activity'}</Sheet.Description></Sheet.Header>
  <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
   {#each ordered as activity (activity.key)}
    {@const target = (activity.scope === 'server' ? servers : lists).find((item) => item.id === activity.targetId)}
    <article class="space-y-2 rounded-lg border p-4 text-sm">
    <a download={activity.download ? 'facmandu-mods.tar.gz' : undefined} href={activity.download ?? (activity.scope === 'server' ? `/servers/${activity.targetId}?tab=${activity.task === 'version-download' ? 'settings' : activity.task === 'stop' ? 'console' : ['save-create', 'save-backup'].includes(activity.task ?? '') ? 'saves' : 'mods'}` : `/modlists/${activity.targetId}`)} onclick={() => { if (!activity.download) open = false; }} class="block space-y-2 hover:text-primary">
     <p class="truncate font-medium">{target?.name || (activity.scope === 'server' ? 'Server' : 'Mod list')}</p>
     <p class={activity.state === 'error' ? 'text-amber-500' : 'text-muted-foreground'}>{activity.message}{activity.download ? ' ↓' : ''}</p>
     {#if activity.state === 'running'}<progress max={Math.max(1, activity.total)} value={activity.total ? activity.completed : undefined} class="h-1 w-full accent-primary" aria-label="Task progress"></progress>{#if activity.total}<p class="text-muted-foreground text-xs">{activity.completed} / {activity.total}</p>{/if}{/if}
    </a>
    {#if activity.details?.length}<details><summary class="cursor-pointer text-xs text-muted-foreground">Details</summary><ul class="mt-2 space-y-1 break-words text-xs text-muted-foreground">{#each activity.details as detail, index (index)}<li>{detail}</li>{/each}</ul></details>{/if}
    </article>
   {:else}<p class="text-muted-foreground py-6 text-sm">No recent activity</p>{/each}
  </div>
 </Sheet.Content>
</Sheet.Root>
