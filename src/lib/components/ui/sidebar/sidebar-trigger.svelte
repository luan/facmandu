<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import type { ComponentProps } from 'svelte';
	import { useSidebar } from './context.svelte.js';
	import { PanelRightCloseIcon, PanelRightIcon } from '@lucide/svelte';

	let {
		ref = $bindable(null),
		flipped = $bindable(false),
		class: className,
		onclick,
		...restProps
	}: ComponentProps<typeof Button> & {
		onclick?: (e: MouseEvent) => void;
		flipped?: boolean;
	} = $props();

	const sidebar = useSidebar();
</script>

<Button
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon"
	class={cn('size-7', className)}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	{#if sidebar.isMobile ? sidebar.openMobile : sidebar.open}
		{#if flipped}
			<PanelRightCloseIcon />
		{:else}
			<PanelLeftCloseIcon />
		{/if}
	{:else if flipped}
		<PanelRightIcon />
	{:else}
		<PanelLeftIcon />
	{/if}
	<span class="sr-only">Toggle Sidebar</span>
</Button>
