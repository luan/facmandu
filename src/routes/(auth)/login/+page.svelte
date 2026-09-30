<script lang="ts">
 import ProviderLogin from '$lib/components/ProviderLogin.svelte';
	import { LogInIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import type { PageProps } from './$types';
	let { form }: PageProps = $props();
	let pending = $state(false);
	let requestError = $state('');
	const redirectQuery = $derived(page.url.searchParams.get('redirectTo') ? `?${new URLSearchParams({ redirectTo: page.url.searchParams.get('redirectTo') ?? '/' })}` : '');
</script>

<svelte:head><title>Log in · Facmandu</title></svelte:head>
<div class="flex min-h-svh w-full items-center justify-center p-4">
	<Card.Root class="mx-auto w-full max-w-sm">
		<Card.Header><Card.Title class="text-2xl">Log in</Card.Title><Card.Description>Welcome back to Facmandu.</Card.Description></Card.Header>
		<Card.Content>
			<form method="POST" use:enhance={() => {
				pending = true; requestError = '';
				return async ({ result, update }) => {
					try {
						if (result.type === 'error') requestError = result.error.message ?? 'Could not submit. Try again.';
						else await update({ reset: false });
					} finally { pending = false; }
				};
			}} aria-busy={pending}>
				<fieldset disabled={pending} class="grid gap-3">
				<label for="username" class="text-sm font-medium">Username</label>
				<Input id="username" name="username" autocomplete="username" required minlength={2} maxlength={50} value={form?.username ?? ''}  aria-describedby="form-message" />
				<label for="password" class="text-sm font-medium">Password</label>
				<Input id="password" name="password" type="password" autocomplete="current-password" required minlength={1} maxlength={1024} aria-describedby="form-message" />
				<p id="form-message" role="alert" class="text-sm text-destructive">{requestError || form?.message || ''}</p>
				<Button type="submit" class="w-full"><LogInIcon class="size-4" />{pending ? 'Please wait…' : "Log in"}</Button>
				</fieldset>
			</form>
 <div class="mt-4 grid gap-3 border-t border-border pt-4"><ProviderLogin provider="codex" name="Codex" issuer="OpenAI" /><ProviderLogin provider="meta" name="Muse" issuer="Meta" /><ProviderLogin provider="copilot" name="Copilot" issuer="GitHub" /></div>
			<p class="mt-4 text-center text-sm">New to Facmandu? <a href="/register{redirectQuery}" class="underline">Create an account</a></p>
		</Card.Content>
	</Card.Root>
</div>
