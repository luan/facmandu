<script lang="ts">
	import LogoutLink from './LogoutLink.svelte';

	import { ChevronDownIcon, MoonIcon, SettingsIcon, SunIcon, UserIcon } from '@lucide/svelte';
	import { resetMode, setMode } from 'mode-watcher';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	import Button, { buttonVariants } from '$lib/components/ui/button/button.svelte';

	let { data, children } = $props();
</script>

<div class="[--header-height:calc(--spacing(14))]">
	<header class="bg-background sticky top-0 z-50 flex w-full items-center border-b">
		<div class="flex h-(--header-height) w-full items-center gap-2 px-4 py-2">
			<Button variant="ghost" href="/">Home</Button>
			<div class="w-full"></div>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'icon' })}>
					<SunIcon
						class="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
					/>
					<MoonIcon
						class="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
					/>
					<span class="sr-only">Toggle theme</span>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onclick={() => setMode('light')}>Light</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => setMode('dark')}>Dark</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => resetMode()}>System</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost' })}
					><UserIcon />{data.user.username}
					<ChevronDownIcon />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content>
					<DropdownMenu.Group>
						<DropdownMenu.Item
							><Button variant="ghost" href="/settings" class="flex items-center gap-2"
								><SettingsIcon />Settings</Button
							></DropdownMenu.Item
						>
						<DropdownMenu.Item><LogoutLink /></DropdownMenu.Item>
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</header>

	{@render children()}
</div>
