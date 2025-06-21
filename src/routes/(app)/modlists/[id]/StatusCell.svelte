<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { Mod } from '$lib/server/db/schema';
	import { broadcastModToggled } from '$lib/stores/realtime.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	interface Props {
		mod: Mod;
		/**
		 * Whether this mod is a dependency of another enabled mod.
		 * If true and the mod is already enabled, it cannot be disabled.
		 */
		isDependency?: boolean;
		/** Whether mod is marked essential */
		isEssential?: boolean;
	}

	let { mod, isDependency = false, isEssential = false }: Props = $props();

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
		disabled={(mod.enabled && isDependency) || isEssential}
		title={mod.enabled && isDependency
			? 'Cannot disable required dependency'
			: isEssential
				? 'Essential mods cannot be disabled'
				: undefined}
	>
		{mod.enabled ? 'On' : 'Off'}
	</Button>
</form>
