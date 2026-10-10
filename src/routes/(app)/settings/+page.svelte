<script lang="ts">
 import { toast } from 'svelte-sonner';
 import ProviderLogin from '$lib/components/ProviderLogin.svelte';
 import { PlusIcon, SaveIcon, TrashIcon, KeyRoundIcon } from '@lucide/svelte';
 import { enhance } from '$app/forms';
 import type { SubmitFunction } from '@sveltejs/kit';
 import * as Card from '$lib/components/ui/card';
 import * as Dialog from '$lib/components/ui/dialog';
 import { Input } from '$lib/components/ui/input';
 import { Button } from '$lib/components/ui/button';
 import type { PageProps } from './$types';
 let { data, form }: PageProps = $props();
 let pending = $state(false);
 let open = $state(false);
 let selection = $state('');
 const connected = $derived(data.providers.filter(provider => provider.connected));
 const selected = $derived(data.providers.find(provider => `${provider.mode}:${provider.id}` === selection));
 const accountProvider = $derived(selected?.mode === 'account' && (selected.id === 'codex' || selected.id === 'meta' || selected.id === 'copilot') ? selected.id : null);
 const submit: SubmitFunction = () => {
  pending = true;
  return async ({ result, update }) => {
   try {
    if (result.type === 'error') toast.error(result.error.message ?? 'Could not save connection');
    else {
     await update({ reset: result.type === 'success' });
     if (result.type === 'success') open = false;
    }
   } finally { pending = false; }
  };
 };
</script>
<svelte:head><title>Account settings · Facmandu</title></svelte:head>
<div class="workbench !max-w-2xl flex flex-col gap-4">
 <header class="window-title"><h1 class="text-xl font-semibold">Account settings</h1></header>
 <Card.Root>
  <Card.Header>
   <Card.Title class="flex items-center justify-between gap-3">AI providers<Button type="button" variant="secondary" onclick={() => { selection = ''; open = true; }}><PlusIcon />Add provider</Button></Card.Title>
   <Card.Description>Connect an account or add an API key. Choose a model in the assistant.</Card.Description>
  </Card.Header>
  <Card.Content>
   {#if connected.length}
    <ul class="divide-y divide-border">
     {#each connected as provider (`${provider.mode}:${provider.id}`)}
      <li class="flex items-center justify-between gap-3 py-3">
       <div><p class="font-medium">{provider.name}</p><p class="text-sm text-muted-foreground">{provider.mode === 'account' ? 'Account connected' : 'API key saved'}</p></div>
       <Button type="button" variant="secondary" onclick={() => { selection = `${provider.mode}:${provider.id}`; open = true; }}>Manage<span class="sr-only"> {provider.name}</span></Button>
      </li>
     {/each}
    </ul>
   {:else}<p class="text-sm text-muted-foreground">No providers connected yet.</p>{/if}
   {#if form?.message}<p role="status" class="mt-3 text-sm">{form.message}</p>{/if}
  </Card.Content>
 </Card.Root>
 <Dialog.Root bind:open>
  <Dialog.Content>
   <Dialog.Header><Dialog.Title>{selected?.connected ? 'Manage provider' : 'Add provider'}</Dialog.Title><Dialog.Description>Provider credentials stay private to your account.</Dialog.Description></Dialog.Header>
   <label for="provider" class="grid gap-2 text-sm font-medium">Provider
    <select id="provider" bind:value={selection} disabled={pending} class="w-full border border-input bg-background px-3 py-2">
     <option value="">Choose a provider</option>
     <optgroup label="Account sign-in">{#each data.providers.filter(provider => provider.mode === 'account') as provider}<option value={`account:${provider.id}`}>{provider.name}</option>{/each}</optgroup>
     <optgroup label="API key">{#each data.providers.filter(provider => provider.mode === 'key') as provider}<option value={`key:${provider.id}`}>{provider.name}</option>{/each}</optgroup>
    </select>
   </label>
   {#if selected}
    {#key selection}
     {#if accountProvider}
      {#if selected.connected}
       <form method="POST" action={`?/${accountProvider}`} use:enhance={submit}><Button type="submit" variant="secondary" name="disconnect" value="true" disabled={pending}><TrashIcon />Disconnect {selected.name}</Button></form>
      {:else}<ProviderLogin linking provider={accountProvider} name={selected.name} issuer={selected.issuer} />{/if}
     {:else}
      <form method="POST" action="?/providerKey" use:enhance={submit} class="grid gap-3">
       <input type="hidden" name="provider" value={selected.id} />
       <label for="provider-key" class="text-sm font-medium">API key</label>
       <Input id="provider-key" name="key" type="password" autocomplete="off" data-1p-ignore maxlength={4096} placeholder={selected.connected ? 'Replace saved key' : `${selected.name} API key`} disabled={pending} />
       {#if selected.id === 'openai'}<p class="text-sm text-muted-foreground">Also used for assistant routing and recommendations for lists you create.</p>{/if}
       <div class="flex flex-wrap gap-2"><Button type="submit" disabled={pending}><KeyRoundIcon />{selected.connected ? 'Replace key' : 'Save key'}</Button>{#if selected.connected}<Button type="submit" variant="secondary" name="remove" value="true" disabled={pending}><TrashIcon />Remove</Button>{/if}</div>
      </form>
     {/if}
    {/key}
   {/if}
   {#if form?.success === false && form?.message}<p role="alert" class="text-sm text-destructive">{form.message}</p>{/if}
  </Dialog.Content>
 </Dialog.Root>
	<Card.Root>
		<Card.Header>
			<Card.Title>Factorio</Card.Title>
			<Card.Description>{data.account?.connected ? `Token saved for ${data.account.username}` : 'Add your service token to search and download mods.'}</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/updateFactorioCredentials" aria-busy={pending} use:enhance={() => {
				pending = true;
				return async ({ result, update }) => {
					try {
						if (result.type === 'error') toast.error(result.error.message ?? 'Could not connect. Try again.');
						else await update({ reset: result.type === 'success' });
					} finally { pending = false; }
				};
			}}>
				<fieldset disabled={pending} class="grid gap-3">
					<label for="factorio-username" class="text-sm font-medium">Factorio username</label>
					<Input id="factorio-username" name="factorioUsername" autocomplete="off" data-1p-ignore required maxlength={100} value={data.account?.username ?? ''} />
					<label for="factorio-token" class="text-sm font-medium">Service token</label>
					<Input id="factorio-token" name="factorioToken" type="password" autocomplete="off" data-1p-ignore required maxlength={1024} />

					<Button type="submit" class="justify-self-start"><SaveIcon class="size-4" />{pending ? 'Saving…' : 'Save token'}</Button>
				</fieldset>
			</form>
			<p class="mt-4 text-sm text-muted-foreground"><a href="https://factorio.com/profile" target="_blank" rel="noreferrer" class="underline">Get your service token</a> from your Factorio profile.</p>
		</Card.Content>
	</Card.Root>
</div>
