<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { Input } from '$lib/components/ui/input';
	import Button from '$lib/components/ui/button/tooltip-button.svelte';
	import { CheckIcon, XIcon, EditIcon } from '@lucide/svelte';
	import { tick } from 'svelte';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		name = '',
		disabled = false
	}: { name?: string; disabled?: boolean } = $props();

	let isEditing = $state(false);
	let editValue = $state('');
	let isSubmitting = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	let message = $state('');

	// Update editValue when name prop changes
	$effect(() => {
		if (!isEditing) {
			editValue = name;
		}
	});

	async function startEditing() {
		message = '';
		isEditing = true;
		editValue = name;
		await tick();
		input?.focus();
		input?.select();
	}

	function cancelEdit() {
		if (isSubmitting) return;
		message = '';
		isEditing = false;
		editValue = name;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			cancelEdit();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			input?.form?.requestSubmit();
		}
	}

	async function handleFormResult(result: ActionResult) {
		try {
			if (result.type === 'success') {
				isEditing = false;
				await Promise.all([invalidate('app:modlist'), invalidate('app:library')]);
			} else message = result.type === 'failure' ? String(result.data?.message || 'Could not rename this list') : 'Could not rename this list';
		} catch { message = 'The name was saved, but this view could not refresh. Try opening the list again.'; }
		finally { isSubmitting = false; }
	}
</script>

{#if isEditing}
	<form
		method="POST"
		action="?/updateModlistName"
		use:enhance={({ cancel }) => {
			if (isSubmitting) { cancel(); return; }
			message = '';
			isSubmitting = true;
			return async ({ result }) => {
				await handleFormResult(result);
			};
		}}
		class="flex items-center gap-2"
	>
		<Input
			bind:ref={input}
			aria-label="Mod list name"
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
				tooltip="Save name"
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
				tooltip="Cancel rename"
				onclick={cancelEdit}
				disabled={isSubmitting}
				class="h-8 w-8 p-0"
			>
				<XIcon class="h-4 w-4" />
			</Button>
		</div>
	</form>
{:else}
	<div class="group flex min-w-0 items-center gap-2">
		<h1 class="break-words text-xl font-semibold">{name}</h1>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			tooltip="Rename list"
			onclick={startEditing}
			{disabled}
			class="h-8 w-8 shrink-0 p-0 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
		>
			<EditIcon class="h-4 w-4" />
		</Button>
	</div>
{/if}
{#if message}<p role="alert" class="text-destructive text-sm">{message}</p>{/if}
