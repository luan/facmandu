<script lang="ts">
	import '../app.css';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Toaster } from 'svelte-sonner';

	let { children } = $props();
</script>

<svelte:head>
	<title>Facmandu</title>
</svelte:head>
<Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
	{@render children?.()}
</Tooltip.Provider>
<Toaster theme="dark" richColors closeButton />
