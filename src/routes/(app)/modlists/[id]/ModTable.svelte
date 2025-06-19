<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { CheckIcon, TrashIcon } from '@lucide/svelte';
	import type { Mod } from '$lib/server/db/schema';

	interface Props {
		mods: Mod[];
		modlistName: string;
	}

	let { mods, modlistName }: Props = $props();
	let confirmDeleteId: string | null = $state(null);

	function handleDeleteClick(modId: string) {
		if (confirmDeleteId === modId) {
			// Second click - proceed with deletion
			confirmDeleteId = null;
		} else {
			// First click - set confirmation state
			confirmDeleteId = modId;
			// Auto-reset confirmation after 3 seconds
			setTimeout(() => {
				if (confirmDeleteId === modId) {
					confirmDeleteId = null;
				}
			}, 3000);
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Mods in {modlistName}</Card.Title>
	</Card.Header>
	<Card.Content>
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-2 max-w-2">Enabled</Table.Head>
					<Table.Head class="w-[100px]">Name</Table.Head>
					<Table.Head class="w-2 max-w-2">Actions</Table.Head>
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
						<Table.Cell>
							{#if confirmDeleteId === mod.id}
								<form method="POST" action="?/removeMod" use:enhance>
									<input type="hidden" name="modName" value={mod.name} />
									<Button
										type="submit"
										variant="destructive"
										size="sm"
										class="h-8 w-8 p-0"
										title="Confirm deletion"
									>
										<TrashIcon class="h-4 w-4" />
									</Button>
								</form>
							{:else}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-8 w-8 p-0"
									disabled={mod.enabled}
									onclick={() => handleDeleteClick(mod.id)}
									title={mod.enabled ? 'Disable mod first to remove it' : 'Click to remove mod'}
								>
									<TrashIcon class="h-4 w-4" />
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</Card.Content>
</Card.Root>
