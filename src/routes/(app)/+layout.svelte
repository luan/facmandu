<script lang="ts">
	import AppHeader from './AppHeader.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import ModLists from './ModLists.svelte';

	let { data, children } = $props();
</script>

<div class="[--header-height:calc(--spacing(14))]">
	<Sidebar.Provider open={data.sidebarOpen} class="flex flex-col">
		<AppHeader username={data.user.username} />
		<div class="flex flex-1">
			<Sidebar.Root class="top-(--header-height) h-[calc(100svh-var(--header-height))]!">
				<Sidebar.Content>
					<ModLists modLists={data.modLists} />
				</Sidebar.Content>
			</Sidebar.Root>

			<Sidebar.Inset>
				{@render children()}
			</Sidebar.Inset>
		</div>
	</Sidebar.Provider>
</div>
