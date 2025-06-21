<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { Mod } from '$lib/server/db/schema';
	import { broadcastModToggled } from '$lib/stores/realtime.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { LockIcon, PackageCheck } from '@lucide/svelte';

	interface Props {
		mod: Mod;
		/**
		 * Whether this mod is a dependency of another enabled mod.
		 * If true and the mod is already enabled, it cannot be disabled.
		 */
		isDependency?: boolean;
		/** Whether mod is marked essential */
		isEssential?: boolean;
		/** User who locked this mod (i.e., set it as essential) */
		lockedByUser?: {
			id: string;
			username: string;
		} | null;
	}

	let { mod, isDependency = false, isEssential = false, lockedByUser = null }: Props = $props();

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

{#if isEssential}
	<!-- Locked indicator -->
	<div
		class="flex flex-col items-center gap-1"
		title={lockedByUser ? `Locked by ${lockedByUser.username}` : 'Locked mod'}
	>
		<LockIcon class="h-4 w-4 text-amber-500" />
		{#if lockedByUser}
			<div class="text-muted-foreground text-xs">(by {lockedByUser.username})</div>
		{/if}
	</div>
{:else if isDependency}
	<div class="flex flex-col items-center gap-1">
		<PackageCheck class="h-4 w-4 text-amber-500" />
		<div class="text-muted-foreground text-xs">(dependency)</div>
	</div>
{:else}
	<form
		method="POST"
		action="?/toggleStatus"
		class="flex flex-col items-center gap-1"
		use:enhance={handleToggle}
	>
		<input type="hidden" name="modid" value={mod.id} />
		<Button
			type="submit"
			variant={mod.enabled ? 'default' : 'outline'}
			size="sm"
			class="h-6 px-2 text-xs"
			disabled={mod.enabled && isDependency}
			title={mod.enabled && isDependency ? 'Cannot disable required dependency' : undefined}
		>
			{mod.enabled ? 'On' : 'Off'}
		</Button>
	</form>
{/if}
