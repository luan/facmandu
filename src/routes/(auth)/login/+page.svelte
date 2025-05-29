<script lang="ts">
	import { LogInIcon } from '@lucide/svelte';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { loginSchema, type LoginSchema } from './schema';
	import * as Card from '$lib/components/ui/card';

	let { data }: { data: { form: SuperValidated<Infer<LoginSchema>> } } = $props();

	const form = superForm(data.form, {
		validators: zodClient(loginSchema)
	});

	const { form: formData, enhance, message } = form;
</script>

<div class="flex h-screen w-full items-center justify-center px-4">
	<Card.Root class="mx-auto w-full max-w-sm">
		<Card.Header>
			<Card.Title class="text-2xl">Login</Card.Title>
			<Card.Description>Enter your credentials below to login</Card.Description>
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

				<Form.Button class="w-full">
					<LogInIcon />
					Login</Form.Button
				>
				<p style="color: red">{$message}</p>
			</form>
			<div class="mt-4 text-center text-sm">
				Don't have an account?
				<a href="/register" class="underline"> Sign up </a>
			</div>
		</Card.Content>
	</Card.Root>
</div>
