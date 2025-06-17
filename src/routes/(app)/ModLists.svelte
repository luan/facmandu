<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	import { PlusIcon } from '@lucide/svelte';

	let { modLists } = $props();
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
							<a href={`/modlists/${modList.id}`} {...props}>
								{modList.name}
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
