<script lang="ts">
 import { toast } from 'svelte-sonner';
 import ProviderLogin from '$lib/components/ProviderLogin.svelte';
	import { KeyRoundIcon, SaveIcon, TrashIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let pending = $state(false);

</script>
<svelte:head><title>Account settings · Facmandu</title></svelte:head>
<div class="workbench !max-w-2xl flex flex-col gap-4">
	<header class="window-title"><h1 class="text-xl font-semibold">Account settings</h1></header>
 <Card.Root>
  <Card.Header><Card.Title>Codex</Card.Title><Card.Description>{data.codexConnected ? 'Connected' : 'Connect to use the mod-list assistant and sign in with Codex.'}</Card.Description></Card.Header>
  <Card.Content class="space-y-3">
   {#if !data.codexConnected}<ProviderLogin linking provider="codex" name="Codex" issuer="OpenAI" />{:else}
    <form method="POST" action="?/codex" use:enhance class="flex flex-wrap items-end gap-3">
     <Button type="submit" variant="secondary" name="disconnect" value="true"><TrashIcon />Disconnect</Button>
    </form>
   {/if}
  </Card.Content>
 </Card.Root>
 <Card.Root>
  <Card.Header><Card.Title>Muse</Card.Title><Card.Description>{data.metaConnected ? 'Connected' : 'Connect to use Muse models in the mod-list assistant and sign in with Muse.'}</Card.Description></Card.Header>
  <Card.Content class="space-y-3">
   {#if !data.metaConnected}<ProviderLogin linking provider="meta" name="Muse" issuer="Meta" />{:else}
    <form method="POST" action="?/meta" use:enhance class="flex flex-wrap items-end gap-3">
     <Button type="submit" variant="secondary" name="disconnect" value="true"><TrashIcon />Disconnect</Button>
    </form>
   {/if}
  </Card.Content>
 </Card.Root>
 <Card.Root>
  <Card.Header><Card.Title>Copilot</Card.Title><Card.Description>{data.copilotConnected ? 'Connected' : 'Connect to use Copilot models in the mod-list assistant and sign in with Copilot.'}</Card.Description></Card.Header>
  <Card.Content class="space-y-3">
   {#if !data.copilotConnected}<ProviderLogin linking provider="copilot" name="Copilot" issuer="GitHub" />{:else}
    <form method="POST" action="?/copilot" use:enhance class="flex flex-wrap items-end gap-3">
     <Button type="submit" variant="secondary" name="disconnect" value="true"><TrashIcon />Disconnect</Button>
    </form>
   {/if}
  </Card.Content>
 </Card.Root>
 <Card.Root>
  <Card.Header><Card.Title class="flex items-center gap-2"><KeyRoundIcon />TypeSafe</Card.Title><Card.Description>{data.typesafeConnected ? 'Key saved' : 'No key configured'} · Used by lists you create.</Card.Description></Card.Header>
  <Card.Content>
   <form method="POST" action="?/typesafe" use:enhance={() => { pending = true;  return async ({ result, update }) => { try { if (result.type === 'error') toast.error(result.error.message ?? 'Could not save key'); else await update(); } finally { pending = false; } }; }} class="grid gap-3">
    <label for="typesafe-key">API key</label><Input id="typesafe-key" name="key" type="password" autocomplete="off" maxlength={4096} placeholder={data.typesafeConnected ? 'Replace saved key' : 'TypeSafe API key'} />
    <div class="flex gap-2"><Button type="submit" disabled={pending}><SaveIcon />Save key</Button>{#if data.typesafeConnected}<Button type="submit" variant="secondary" name="remove" value="true" disabled={pending}><TrashIcon />Remove</Button>{/if}</div>
   </form>
  </Card.Content>
 </Card.Root>
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
					<Input id="factorio-username" name="factorioUsername" autocomplete="username" required maxlength={100} value={data.account?.username ?? ''} />
					<label for="factorio-token" class="text-sm font-medium">Service token</label>
					<Input id="factorio-token" name="factorioToken" type="password" autocomplete="off" required maxlength={1024} />

					<Button type="submit" class="justify-self-start"><SaveIcon class="size-4" />{pending ? 'Saving…' : 'Save token'}</Button>
				</fieldset>
			</form>
			<p class="mt-4 text-sm text-muted-foreground"><a href="https://factorio.com/profile" target="_blank" rel="noreferrer" class="underline">Get your service token</a> from your Factorio profile.</p>
		</Card.Content>
	</Card.Root>
</div>
