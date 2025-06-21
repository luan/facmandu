<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { Mod } from '$lib/server/db/schema';
	import { broadcastModToggled } from '$lib/stores/realtime.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	interface Props {
		mod: Mod;
	}

	let { mod }: Props = $props();

	const handleToggle: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.success) {
				// Broadcast the change to other tabs
				broadcastModToggled(mod.modlist, mod.id, result.data.newStatus);
			}
			// Always update the current tab
			await update();
		};
	};
</script>

<form method="POST" action="?/toggleStatus" use:enhance={handleToggle}>
	<input type="hidden" name="modid" value={mod.id} />
	<Button
		type="submit"
		variant={mod.enabled ? 'default' : 'outline'}
		size="sm"
		class="h-6 px-2 text-xs"
	>
		{mod.enabled ? 'On' : 'Off'}
	</Button>
</form>
