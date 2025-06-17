<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let modlist = data.modlist;
	let mods = data.mods;
</script>

<div class="flex h-[calc(100svh-var(--header-height))] w-full flex-col gap-4 px-48 py-4">
	<h1>{modlist?.name}</h1>
	{#each mods as mod (mod.id)}
		<p>
			{mod.name} | {mod.enabled}
		</p>
	{/each}
</div>
