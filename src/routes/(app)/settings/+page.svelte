<script lang="ts">
	import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms/client';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { schema, type Schema } from './schema';
	import * as Form from '$lib/components/ui/form';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Link2Icon } from '@lucide/svelte';

	let { data }: { data: { form: SuperValidated<Infer<Schema>> } } = $props();

	const form = superForm(data.form, {
		validators: zodClient(schema)
	});

	const { form: formData, enhance, message } = form;
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-6 p-4">
	<h1>Settings</h1>
	<Card.Root class="mx-auto w-full max-w-sm">
		<Card.Header>
			<Card.Title class="text-2xl">Factorio.com Account</Card.Title>
			<Card.Description
				>Enter your factorio.com credentials below to connect your account</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/updateFactorioCredentials" class="grid gap-4" use:enhance>
				<Form.Field {form} name="factorioUsername">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Factorio username</Form.Label>
							<Input {...props} bind:value={$formData.factorioUsername} />
						{/snippet}
					</Form.Control>
					<Form.Description />
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="factorioPassword">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Factorio password</Form.Label>
							<Input {...props} bind:value={$formData.factorioPassword} type="password" />
						{/snippet}
					</Form.Control>
					<Form.Description />
					<Form.FieldErrors />
				</Form.Field>

				<Form.Button class="w-full">
					<Link2Icon />
					Connect</Form.Button
				>
				<p style="color: red">{$message}</p>
			</form>
			<div class="text-muted-foreground mt-4 text-sm">
				<p>
					<strong>Note:</strong> Your Factorio password is only used to authenticate with the Factorio
					API. We store only the authentication token, not your password.
				</p>
			</div>
		</Card.Content>
	</Card.Root>
</div>
