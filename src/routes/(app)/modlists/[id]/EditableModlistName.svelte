<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { CheckIcon, XIcon, EditIcon } from '@lucide/svelte';
	import { tick } from 'svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import { broadcastModlistNameUpdated } from '$lib/stores/realtime.svelte';

	let {
		name = '',
		disabled = false,
		modlistId
	}: { name?: string; disabled?: boolean; modlistId: string } = $props();

	let isEditing = $state(false);
	let editValue = $state(name);
	let isSubmitting = $state(false);

	// Update editValue when name prop changes
	$effect(() => {
		if (!isEditing) {
			editValue = name;
		}
	});

	async function startEditing() {
		isEditing = true;
		editValue = name;
		await tick();
		// Focus the input after it's rendered
		const input = document.querySelector('input[name="name"]') as HTMLInputElement;
		if (input) {
			input.focus();
			input.select();
		}
	}

	function cancelEdit() {
		isEditing = false;
		editValue = name;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			cancelEdit();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const form = (event.target as HTMLElement)?.closest('form');
			form?.requestSubmit();
		}
	}

	async function handleFormResult(result: ActionResult) {
		isSubmitting = false;
		if (result.type === 'success') {
			isEditing = false;
			// Broadcast the name change to other tabs
			if (modlistId && editValue.trim()) {
				broadcastModlistNameUpdated(modlistId, editValue.trim());
			}
			// Invalidate page data to refresh the modlist name
			await invalidateAll();
		}
	}
</script>

{#if isEditing}
	<form
		method="POST"
		action="?/updateModlistName"
		use:enhance={() => {
			isSubmitting = true;
			return async ({ result }) => {
				handleFormResult(result);
			};
		}}
		class="flex items-center gap-2"
	>
		<Input
			bind:value={editValue}
			name="name"
			type="text"
			class="border-none p-0 text-2xl font-bold shadow-none focus-visible:ring-1 focus-visible:ring-offset-0"
			style="background: transparent;"
			maxlength={100}
			required
			{disabled}
			onkeydown={handleKeydown}
		/>
		<div class="flex items-center gap-1">
			<Button
				type="submit"
				variant="ghost"
				size="sm"
				disabled={isSubmitting || !editValue.trim() || editValue.trim() === name}
				class="h-8 w-8 p-0"
			>
				<CheckIcon class="h-4 w-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={cancelEdit}
				disabled={isSubmitting}
				class="h-8 w-8 p-0"
			>
				<XIcon class="h-4 w-4" />
			</Button>
		</div>
	</form>
{:else}
	<div class="group flex items-center gap-2">
		<h1 class="text-2xl font-bold">{name}</h1>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			onclick={startEditing}
			{disabled}
			class="h-8 w-8 p-0 opacity-0 transition-opacity group-hover:opacity-100"
		>
			<EditIcon class="h-4 w-4" />
		</Button>
	</div>
{/if}
