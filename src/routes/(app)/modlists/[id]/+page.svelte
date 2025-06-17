<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let modlist = data.modlist;
	let mods = data.mods;
</script>

<div class="flex h-[calc(100svh-var(--header-height))] w-full flex-col gap-4 px-48 py-4">
	<h1>{modlist?.name}</h1>
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="w-2 max-w-2">Enabled</Table.Head>
				<Table.Head class="w-[100px]">Name</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each mods as mod (mod.id)}
				<Table.Row>
					<Table.Cell><Checkbox class="m-auto" bind:checked={mod.enabled} /></Table.Cell>
					<Table.Cell class="font-medium">{mod.name}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
