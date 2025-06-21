<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';

	let { open = $bindable(false), modName = null }: { open: boolean; modName: string | null } =
		$props();
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full !max-w-[800px] flex-col sm:w-[800px]">
		{#if modName}
			<iframe
				src={`https://mods.factorio.com/mod/${modName}`}
				title={`Preview of ${modName}`}
				class="h-full w-full flex-1"
			></iframe>
		{/if}
	</Sheet.Content>
</Sheet.Root>
