<script lang="ts">
	import { UserPlusIcon } from '@lucide/svelte';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { registerSchema, type RegisterSchema } from './schema';
	import * as Card from '$lib/components/ui/card';

	let { data }: { data: { form: SuperValidated<Infer<RegisterSchema>> } } = $props();

	const form = superForm(data.form, {
		validators: zodClient(registerSchema)
	});

	const { form: formData, enhance, message } = form;
</script>

<div class="flex h-screen w-full items-center justify-center px-4">
	<Card.Root class="mx-auto w-full max-w-sm">
		<Card.Header>
			<Card.Title class="text-2xl">Register</Card.Title>
			<Card.Description>Enter your credentials below to register</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" class="grid gap-4" use:enhance>
				<Form.Field {form} name="username">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Username</Form.Label>
							<Input {...props} bind:value={$formData.username} />
						{/snippet}
					</Form.Control>
					<Form.Description />
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="password">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Password</Form.Label>
							<Input {...props} bind:value={$formData.password} type="password" />
						{/snippet}
					</Form.Control>
					<Form.Description />
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="confirm">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Confirm Password</Form.Label>
							<Input {...props} bind:value={$formData.confirm} type="password" />
						{/snippet}
					</Form.Control>
					<Form.Description />
					<Form.FieldErrors />
				</Form.Field>

				<Form.Button class="w-full">
					<UserPlusIcon />
					Register</Form.Button
				>
				<p style="color: red">{$message}</p>
			</form>
			<div class="mt-4 text-center text-sm">
				Already have an account?
				<a href="/login" class="underline"> Login </a>
			</div>
		</Card.Content>
	</Card.Root>
</div>
