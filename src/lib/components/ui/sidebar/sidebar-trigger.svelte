<script lang="ts">
	import Button from '$lib/components/ui/button/tooltip-button.svelte';
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
		children,
		variant = 'ghost',
		tooltip = 'Toggle sidebar',
		size = children ? 'sm' : 'icon',
		...restProps
	}: Omit<ComponentProps<typeof Button>, 'tooltip'> & {
		tooltip?: string;
		onclick?: (e: MouseEvent) => void;
		flipped?: boolean;
	} = $props();

	const sidebar = useSidebar();
</script>

<Button
	{tooltip}
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	{variant}
	{size}
	class={cn(children ? 'gap-2' : 'size-7', className)}
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
	{#if children}{@render children()}{:else}<span class="sr-only">Toggle Sidebar</span>{/if}
</Button>
