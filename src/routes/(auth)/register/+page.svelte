<script lang="ts">
 import ProviderLogin from '$lib/components/ProviderLogin.svelte';
	import { UserPlusIcon } from '@lucide/svelte';
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

<svelte:head><title>Create account · Facmandu</title></svelte:head>
<div class="flex min-h-svh w-full items-center justify-center p-4">
	<Card.Root class="mx-auto w-full max-w-sm">
		<Card.Header><Card.Title class="text-2xl">Create account</Card.Title><Card.Description>An invitation from an administrator is required.</Card.Description></Card.Header>
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
				<label for="invite" class="text-sm font-medium">Invite code</label>
				<Input id="invite" name="invite" required maxlength={100} autocomplete="off" value={page.url.searchParams.get("invite") ?? ""} />
				<label for="username" class="text-sm font-medium">Username</label>
				<Input id="username" name="username" autocomplete="username" required minlength={3} maxlength={31} value={form?.username ?? ''} pattern="(?:[a-z0-9_]|-)+" aria-describedby="username-hint form-message" />
				<p id="username-hint" class="text-xs text-muted-foreground">3–31 lowercase letters, numbers, underscores or hyphens.</p>
				<label for="password" class="text-sm font-medium">Password</label>
				<Input id="password" name="password" type="password" autocomplete="new-password" required minlength={6} maxlength={1024} aria-describedby="form-message" />
				<label for="confirm" class="text-sm font-medium">Confirm password</label>
				<Input id="confirm" name="confirm" type="password" autocomplete="new-password" required maxlength={1024} aria-describedby="form-message" />
				<p id="form-message" role="alert" class="text-sm text-destructive">{requestError || form?.message || ''}</p>
				<Button type="submit" class="w-full"><UserPlusIcon class="size-4" />{pending ? 'Please wait…' : "Create account"}</Button>
				</fieldset>
			</form>
 <div class="mt-4 grid gap-3 border-t border-border pt-4"><ProviderLogin provider="codex" name="Codex" issuer="OpenAI" /><ProviderLogin provider="meta" name="Muse" issuer="Meta" /><ProviderLogin provider="copilot" name="Copilot" issuer="GitHub" /></div>
			<p class="mt-4 text-center text-sm">Already have an account? <a href="/login{redirectQuery}" class="underline">Log in</a></p>
		</Card.Content>
	</Card.Root>
</div>
