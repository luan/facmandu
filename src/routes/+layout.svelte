<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';

	let { children } = $props();
</script>

<ModeWatcher defaultMode="dark" />
<svelte:head>
	<title>Facmandu</title>
</svelte:head>
{@render children?.()}
