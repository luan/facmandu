<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import { CheckIcon } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let modlist = $derived(data.modlist);
	let mods = $derived(data.mods);
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
					<Table.Cell>
						<form method="POST" action="?/toggleStatus" use:enhance>
							<input type="hidden" name="modid" value={mod.id} />
							<Button
								type="submit"
								data-slot="checkbox"
								data-state={mod.enabled ? 'checked' : ''}
								variant="outline"
								size="icon-tight"
								class="border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive peer m-auto flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
							>
								<div data-slot="checkbox-indicator" class="text-current transition-none">
									{#if mod.enabled}
										<CheckIcon class="size-3.5" />
									{/if}
								</div>
							</Button>
						</form>
					</Table.Cell>
					<Table.Cell class="font-medium">{mod.name}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
