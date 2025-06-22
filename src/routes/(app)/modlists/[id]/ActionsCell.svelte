<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { TrashIcon, RefreshCwIcon, LockIcon, UnlockIcon, SnowflakeIcon } from '@lucide/svelte';
	import type { Mod } from '$lib/server/db/schema';
	import { broadcastModRemoved, broadcastModlistUpdated } from '$lib/stores/realtime.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	interface Props {
		mod: Mod;
		confirmDeleteId: string | null;
		onDeleteClick: (modId: string) => void;
	}

	let { mod, confirmDeleteId, onDeleteClick }: Props = $props();

	const handleRemove: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.success) {
				// Broadcast the removal to other tabs
				broadcastModRemoved(mod.modlist, mod.name);
			}
			// Always update the current tab
			await update();
		};
	};

	const handleToggleEssential: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.success) {
				// Broadcast change to other tabs
				broadcastModlistUpdated(mod.modlist, []);
			}
			await update();
		};
	};

	const handleMoveToIcebox: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.success) {
				broadcastModlistUpdated(mod.modlist, []);
			}
			await update();
		};
	};

	function formatDate(date?: Date | null): string {
		if (!date) return 'N/A';
		try {
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

			if (diffDays < 1) return 'Today';
			if (diffDays < 30) return `${diffDays}d`;
			if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
			return `${Math.floor(diffDays / 365)}y`;
		} catch {
			return 'N/A';
		}
	}
</script>

<div class="flex items-center gap-1">
	<!-- Refresh Button -->
	<form method="POST" action="?/refreshMod" use:enhance>
		<input type="hidden" name="modId" value={mod.id} />
		<input type="hidden" name="modName" value={mod.name} />
		<Tooltip.Root>
			<Tooltip.Trigger>
				<Button type="submit" variant="ghost" size="sm" class="h-6 w-6 p-0">
					<RefreshCwIcon class="h-3 w-3" />
				</Button>
			</Tooltip.Trigger>
			<Tooltip.Content>
				<p>Refresh mod info</p>
				{#if mod.lastFetched}
					<p class="text-muted-foreground text-xs">
						Last: {formatDate(mod.lastFetched)}
					</p>
				{/if}
			</Tooltip.Content>
		</Tooltip.Root>
	</form>

	{#if !mod.enabled}
		<!-- Move to Icebox Button -->
		<form method="POST" action="?/moveToIcebox" use:enhance={handleMoveToIcebox}>
			<input type="hidden" name="modId" value={mod.id} />
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button type="submit" variant="ghost" size="sm" class="h-6 w-6 p-0">
						<SnowflakeIcon class="h-3 w-3" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>Move to Icebox</p>
				</Tooltip.Content>
			</Tooltip.Root>
		</form>
		<!-- Delete Button -->
		{#if confirmDeleteId === mod.id}
			<form method="POST" action="?/removeMod" use:enhance={handleRemove}>
				<input type="hidden" name="modName" value={mod.name} />
				<Tooltip.Root>
					<Tooltip.Trigger>
						<Button type="submit" variant="destructive" size="sm" class="h-6 w-6 p-0">
							<TrashIcon class="h-3 w-3" />
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p>Confirm deletion</p>
					</Tooltip.Content>
				</Tooltip.Root>
			</form>
		{:else}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="h-6 w-6 p-0"
						disabled={mod.enabled}
						onclick={() => onDeleteClick(mod.id)}
					>
						<TrashIcon class="h-3 w-3" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>
						{mod.enabled ? 'Disable mod first to remove it' : 'Click to remove mod'}
					</p>
				</Tooltip.Content>
			</Tooltip.Root>
		{/if}
	{/if}

	<!-- Essential (lock) toggle -->
	{#if mod.enabled}
		<form method="POST" action="?/toggleEssential" use:enhance={handleToggleEssential}>
			<input type="hidden" name="modid" value={mod.id} />
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button type="submit" variant="ghost" size="sm" class="h-6 w-6 p-0">
						{#if mod.essential}
							<LockIcon class="h-3 w-3" />
						{:else}
							<UnlockIcon class="h-3 w-3" />
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>{mod.essential ? 'Unlock mod (make negotiable)' : 'Lock mod (non-negotiable)'}</p>
				</Tooltip.Content>
			</Tooltip.Root>
		</form>
	{/if}
</div>

<!-- Error indicator -->
{#if mod.fetchError}
	<Tooltip.Root>
		<Tooltip.Trigger>
			<div class="text-destructive mt-1 text-xs">⚠️</div>
		</Tooltip.Trigger>
		<Tooltip.Content class="max-w-60">
			<p class="text-xs">Error: {mod.fetchError}</p>
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
