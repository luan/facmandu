<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { navigating, page } from '$app/state';
	import AppHeader from './AppHeader.svelte';
	import { setActivityState } from '$lib/activity.svelte';
	import type { Activity as ActivityItem } from '$lib/server/activity';
	let { data, children } = $props();
	const activityState = $state<{ items: ActivityItem[] }>({ items: [] });
	setActivityState(activityState);
 $effect(() => {
  const message: unknown = page.form?.message;
  if (typeof message === 'string' && message) {
   if (page.status >= 400) toast.error(message);
   else toast.success(message);
  }
 });
</script>

<div class="app-shell">
	<a href="#main-content" class="bg-background text-foreground sr-only z-[110] border px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
	<AppHeader isAdmin={data.user?.isAdmin ?? false} username={data.user?.username ?? ''} servers={data.servers} lists={data.modLists} canManageServer={data.canManageServer} />
	{#if navigating.to}<div class="bg-primary fixed top-0 right-0 left-0 z-[100] h-0.5 animate-pulse" role="progressbar" aria-label="Loading page"></div>{/if}
	<main id="main-content" tabindex="-1">{@render children()}</main>
</div>
