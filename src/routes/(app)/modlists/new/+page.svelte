<script lang="ts">
	import { PlusIcon } from '@lucide/svelte';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { formSchema, type FormSchema } from './schema';
	import { Textarea } from '$lib/components/ui/textarea';

	let { data }: { data: { form: SuperValidated<Infer<FormSchema>> } } = $props();

	const form = superForm(data.form, {
		validators: zodClient(formSchema)
	});

	const { form: formData, enhance, message } = form;
</script>

<div class="flex h-[calc(100svh-var(--header-height))] w-full flex-col gap-4 px-48 py-4">
	<h1>Create new mod list</h1>
	<form method="POST" class="flex h-full flex-col gap-4" use:enhance>
		<p class="text-red-500">{$message}</p>
		<Form.Field {form} name="name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Name</Form.Label>
					<Input {...props} bind:value={$formData.name} />
				{/snippet}
			</Form.Control>
			<Form.Description />
			<Form.FieldErrors />
		</Form.Field>
		<Form.Field {form} name="json">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>modlist.json</Form.Label>
					<Textarea {...props} bind:value={$formData.json} class="h-120 resize-none font-mono" />
				{/snippet}
			</Form.Control>
			<Form.Description />
			<Form.FieldErrors />
		</Form.Field>

		<div class="h-full"></div>
		<Form.Button>
			<PlusIcon />
			Create</Form.Button
		>
	</form>
</div>
