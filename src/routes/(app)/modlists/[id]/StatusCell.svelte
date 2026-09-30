<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { invalidate } from '$app/navigation';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { ModSummary } from '$lib/server/db/schema';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { LockIcon, PackageCheck, CheckIcon, MinusIcon, LoaderCircleIcon } from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	interface Props {
		mod: Omit<ModSummary, 'updatedBy'>;
		/**
		 * Whether this mod is a dependency of another enabled mod.
		 * If true and the mod is already enabled, it cannot be disabled.
		 */
		isDependency?: boolean;
		/** Whether mod is marked essential */
		isEssential?: boolean;
		readOnly?: boolean;
		/** User who locked this mod (i.e., set it as essential) */
		lockedByUser?: {
			id: string;
			username: string;
		} | null;
		/** List of mods that require this mod */
		requiredBy?: string[];
	}

	let {
		mod,
		isDependency = false,
		isEssential = false,
		readOnly = false,
		lockedByUser = null,
		requiredBy = []
	}: Props = $props();

	let pending = $state(false);
	const handleToggle: SubmitFunction = ({ cancel }) => {
		if (pending) { cancel(); return; }
		pending = true;
		return async ({ result, update }) => {
			try {
				await update({ invalidateAll: false });
				if (result.type === 'success') await invalidate('app:modlist');
				else toast.error(result.type === 'failure' ? String(result.data?.message || 'Could not change mod status') : 'Could not change mod status');
			} finally { pending = false; }
		};
	};
</script>

{#if isEssential && mod.enabled}
	<Tooltip.Root>
		<Tooltip.Trigger class="flex size-7 items-center justify-center text-amber-500" aria-label={`${mod.name} is locked`}>
			<LockIcon class="size-4" />
		</Tooltip.Trigger>
		<Tooltip.Content><p>{lockedByUser ? `Locked by ${lockedByUser.username}` : 'Locked'}</p></Tooltip.Content>
	</Tooltip.Root>
{:else if isDependency && mod.enabled}
	<Tooltip.Root>
		<Tooltip.Trigger class="flex size-7 items-center justify-center text-amber-500" aria-label={`${mod.name} is required by another mod`}>
			<PackageCheck class="size-4" />
		</Tooltip.Trigger>
		<Tooltip.Content><p class="mb-1">Required by:</p><ul class="list-inside list-disc">{#each requiredBy as name (name)}<li>{name}</li>{/each}</ul></Tooltip.Content>
	</Tooltip.Root>
{:else if readOnly}
	<Tooltip.Root>
		<Tooltip.Trigger class="flex size-7 items-center justify-center" aria-label={`${mod.name} is ${mod.enabled ? 'enabled' : 'disabled'}`}>
			{#if mod.enabled}<CheckIcon class="size-4" />{:else}<MinusIcon class="size-4" />{/if}
		</Tooltip.Trigger>
		<Tooltip.Content>{mod.enabled ? 'Enabled' : 'Disabled'}</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<form method="POST" action="?/toggleStatus" use:enhance={handleToggle}>
		<input type="hidden" name="modid" value={mod.id} />
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button {...props} type="submit" variant={mod.enabled ? 'default' : 'outline'} size="icon" class="size-7" aria-label={`${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`} aria-pressed={!!mod.enabled} aria-busy={pending} disabled={pending}>
						{#if pending}<LoaderCircleIcon class="size-4 animate-spin motion-reduce:animate-none" />{:else if mod.enabled}<CheckIcon class="size-4" />{:else}<MinusIcon class="size-4" />{/if}
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{mod.enabled ? 'Enabled' : 'Disabled'}</Tooltip.Content>
		</Tooltip.Root>
	</form>
{/if}
