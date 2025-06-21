<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import { browser } from '$app/environment';
	import type { HTMLAttributes } from 'svelte/elements';
	import {
		SIDEBAR_COOKIE_MAX_AGE,
		SIDEBAR_COOKIE_NAME,
		SIDEBAR_WIDTH,
		SIDEBAR_WIDTH_ICON,
		SIDEBAR_KEYBOARD_SHORTCUT
	} from './constants.js';
	import { setSidebar } from './context.svelte.js';

	// Determine the initial open state from the persisted cookie (client-side only)
	function getInitialOpen() {
		if (!browser) return true;

		const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`));

		return match ? match[1] === 'true' : true;
	}

	let {
		ref = $bindable(null),
		cookieName = SIDEBAR_COOKIE_NAME,
		keyboardShortcut = SIDEBAR_KEYBOARD_SHORTCUT,
		open = $bindable(getInitialOpen()),
		onOpenChange = () => {},
		class: className,
		style,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		cookieName?: string;
		keyboardShortcut?: string;
	} = $props();

	const sidebar = setSidebar({
		open: () => open,
		setOpen: (value: boolean) => {
			open = value;
			onOpenChange(value);

			// Persist sidebar state using the provided cookie name so different providers don't conflict.
			document.cookie = `${cookieName}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
		},
		keyboardShortcut
	});
</script>

<svelte:window onkeydown={sidebar.handleShortcutKeydown} />

<Tooltip.Provider delayDuration={0}>
	<div
		data-slot="sidebar-wrapper"
		style="--sidebar-width: {SIDEBAR_WIDTH}; --sidebar-width-icon: {SIDEBAR_WIDTH_ICON}; {style}"
		class={cn(
			'group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full',
			className
		)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>
