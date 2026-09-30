<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { TrashIcon, RefreshCwIcon, LockIcon, UnlockIcon, SnowflakeIcon } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import Button from '$lib/components/ui/button/button.svelte';
	import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { ModSummary } from '$lib/server/db/schema';
	let { mod, confirmDeleteId, onDeleteClick }: { mod: Omit<ModSummary, 'updatedBy'>; confirmDeleteId: string | null; onDeleteClick: (modId: string) => void } = $props();
	let pending = $state(false);
	const submit: SubmitFunction = ({ cancel }) => {
		if (pending) { cancel(); return; }
		pending = true;
		return async ({ result, update }) => {
			try {
				await update({ invalidateAll: false });
				if (result.type === 'success') await invalidate('app:modlist');
				else toast.error(result.type === 'failure' ? String(result.data?.message || 'Could not update mod') : 'Could not update mod');
			} finally { pending = false; }
		};
	};
</script>
<div class="flex items-center gap-1" aria-busy={pending}>
	<form method="POST" action="?/refreshMod" use:enhance={submit}>
		<input type="hidden" name="modId" value={mod.id} /><input type="hidden" name="modName" value={mod.name} />
		<TooltipButton type="submit" variant="ghost" size="sm" class="h-7 w-7 p-0" disabled={pending} aria-label={`Update ${mod.name}`} tooltip="Update mod"><RefreshCwIcon class={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} /></TooltipButton>
	</form>
	{#if !mod.enabled}
		<form method="POST" action="?/moveToIcebox" use:enhance={submit}>
			<input type="hidden" name="modId" value={mod.id} />
			<TooltipButton type="submit" variant="ghost" size="sm" class="h-7 w-7 p-0" disabled={pending} aria-label={`Move ${mod.name} to icebox`} tooltip="Move to icebox"><SnowflakeIcon class="h-3.5 w-3.5" /></TooltipButton>
		</form>
		{#if confirmDeleteId === mod.id}
			<form method="POST" action="?/removeMod" use:enhance={submit}><input type="hidden" name="modName" value={mod.name} /><Button type="submit" variant="destructive" size="sm" disabled={pending} aria-label={`Confirm removal of ${mod.name}`}><TrashIcon class="size-4" />Remove</Button></form>
		{:else}
			<TooltipButton type="button" variant="ghost" size="sm" class="h-7 w-7 p-0" disabled={pending} aria-label={`Remove ${mod.name}`} tooltip="Remove from list" onclick={() => onDeleteClick(mod.id)}><TrashIcon class="h-3.5 w-3.5" /></TooltipButton>
		{/if}
	{:else}
		<form method="POST" action="?/toggleEssential" use:enhance={submit}><input type="hidden" name="modid" value={mod.id} /><TooltipButton type="submit" variant="ghost" size="sm" class="h-7 w-7 p-0" disabled={pending} aria-label={mod.essential ? `Unlock ${mod.name}` : `Lock ${mod.name}`} tooltip={mod.essential ? 'Unlock' : 'Lock'}>{#if mod.essential}<LockIcon class="h-3.5 w-3.5" />{:else}<UnlockIcon class="h-3.5 w-3.5" />{/if}</TooltipButton></form>
	{/if}
	{#if mod.fetchError}<Tooltip.Root><Tooltip.Trigger class="text-amber-500 text-xs" aria-label="Metadata issue">⚠</Tooltip.Trigger><Tooltip.Content>{mod.fetchError}</Tooltip.Content></Tooltip.Root>{/if}
</div>
