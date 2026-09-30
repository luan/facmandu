<script lang="ts">
	import { page } from '$app/state';
	import LogoutLink from './LogoutLink.svelte';
	import Activity from './Activity.svelte';
	import FactoryWatches from './FactoryWatches.svelte';

	import { ChevronDownIcon, SettingsIcon, UserIcon, ServerIcon, LibraryIcon, ShieldIcon } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	import { buttonVariants } from '$lib/components/ui/button/button.svelte';

	let { username, servers, lists, canManageServer, isAdmin }: { isAdmin: boolean; canManageServer: boolean; username: string; servers: { id: string; name: string }[]; lists: { id: string; name: string }[] } = $props();
</script>

<header class="app-header">
	<div class="flex min-h-14 w-full flex-wrap items-center gap-3 px-3 sm:px-5">
		<a href="/" class="app-brand" aria-label="Facmandu home"><img src="/favicon.webp" width="36" height="36" alt="" /><span>Facmandu</span></a>
		<nav class="app-navigation order-3 w-full sm:order-none sm:w-auto" aria-label="Main navigation">
			{#if canManageServer}<a href="/servers" aria-current={page.url.pathname.startsWith('/servers') ? 'page' : undefined}><ServerIcon class="size-4" />Servers</a>{/if}
			<a href="/modlists" aria-current={page.url.pathname.startsWith('/modlists') ? 'page' : undefined}><LibraryIcon class="size-4" />Mod library</a>
		</nav>
		<div class="flex-1"></div>

		{#if username}
			{#if canManageServer}<FactoryWatches {servers} />{/if}
			<Activity {servers} {lists} />
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class={buttonVariants({ variant: 'secondary' })} aria-label={username}
					><UserIcon /><span class="hidden sm:inline">{username}</span>
					<ChevronDownIcon class="hidden sm:block" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content>
					<DropdownMenu.Group>
						<DropdownMenu.Item>
							{#snippet child({ props })}<a {...props} href="/settings"><SettingsIcon />Settings</a>{/snippet}
						</DropdownMenu.Item>
						{#if isAdmin}<DropdownMenu.Item>{#snippet child({ props })}<a {...props} href="/admin"><ShieldIcon />Administration</a>{/snippet}</DropdownMenu.Item>{/if}
						<LogoutLink />
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</div>
</header>
