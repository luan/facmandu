<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	import { PlusIcon, CopyIcon, TrashIcon } from '@lucide/svelte';

	let { modLists } = $props();
	let confirmDeleteId: string | null = $state(null);

	function handleDeleteClick(modlistId: string) {
		if (confirmDeleteId === modlistId) {
			confirmDeleteId = null;
		} else {
			confirmDeleteId = modlistId;
			setTimeout(() => {
				if (confirmDeleteId === modlistId) {
					confirmDeleteId = null;
				}
			}, 3000);
		}
	}
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>
		Mod Lists
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger class="ml-auto">
					<Button variant="success" size="icon-tight" href="/modlists/new">
						<PlusIcon />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>Create new mod list</p>
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each modLists as modList (modList.id)}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton>
						{#snippet child({ props })}
							<div class="flex items-center gap-2">
								<a href={`/modlists/${modList.id}`} {...props}>
									{modList.name}
								</a>
								<div class="ml-auto flex items-center gap-1">
									<Tooltip.Provider>
										<Tooltip.Root>
											<Tooltip.Trigger>
												<form method="POST" action="/?/duplicate" use:enhance>
													<input type="hidden" name="modlistId" value={modList.id} />
													<Button variant="ghost" size="icon-tight" type="submit">
														<CopyIcon class="h-3 w-3" />
													</Button>
												</form>
											</Tooltip.Trigger>
											<Tooltip.Content>
												<p>Duplicate mod list</p>
											</Tooltip.Content>
										</Tooltip.Root>
									</Tooltip.Provider>

									<Tooltip.Provider>
										<Tooltip.Root>
											<Tooltip.Trigger>
												{#if confirmDeleteId === modList.id}
													<form
														method="POST"
														action={`/modlists/${modList.id}?/deleteModlist`}
														use:enhance
													>
														<Button variant="destructive" size="icon-tight" type="submit">
															<TrashIcon class="h-3 w-3" />
														</Button>
													</form>
												{:else}
													<Button
														variant="ghost"
														size="icon-tight"
														type="button"
														onclick={() => handleDeleteClick(modList.id)}
													>
														<TrashIcon class="h-3 w-3" />
													</Button>
												{/if}
											</Tooltip.Trigger>
											<Tooltip.Content>
												<p>
													{confirmDeleteId === modList.id ? 'Confirm delete' : 'Delete mod list'}
												</p>
											</Tooltip.Content>
										</Tooltip.Root>
									</Tooltip.Provider>
								</div>
							</div>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
