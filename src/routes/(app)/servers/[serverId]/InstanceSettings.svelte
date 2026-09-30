<script lang="ts">
 import { PencilIcon, SaveIcon } from '@lucide/svelte';
 import { deserialize } from '$app/forms';
 import { invalidateAll } from '$app/navigation';
 import { toast } from 'svelte-sonner';
 import * as Dialog from '$lib/components/ui/dialog';
 import Button from '$lib/components/ui/button/button.svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import type { ManagedServer } from '$lib/server/db/schema';
 let { server }: { server: ManagedServer } = $props();
 let open = $state(false);
 let pending = $state(false);
 async function save(event: SubmitEvent) {
  event.preventDefault(); if (pending || !(event.currentTarget instanceof HTMLFormElement)) return;
  pending = true;
  try {
   const response = await fetch(`/servers/${server.id}/connection?/save`, { method:'POST', headers:{'x-sveltekit-action':'true'}, body:new FormData(event.currentTarget) });
   const result = deserialize(await response.text());
   if (result.type !== 'success') { toast.error(result.type === 'failure' ? String(result.data?.message || 'Could not save server') : 'Could not save server'); return; }
   open = false; toast.success('Server saved'); await invalidateAll();
  } catch { toast.error('Could not save server'); }
  finally { pending = false; }
 }
</script>
<TooltipButton tooltip="Edit server" variant="ghost" size="icon" onclick={() => open = true}><PencilIcon class="size-4" /></TooltipButton>
<Dialog.Root bind:open>
 <Dialog.Content class="sm:max-w-md">
  <Dialog.Header><Dialog.Title>Edit server</Dialog.Title><Dialog.Description class="sr-only">Name and network ports for this instance.</Dialog.Description></Dialog.Header>
  <form onsubmit={save} class="space-y-4 p-4">
   <label class="grid gap-1.5 text-sm">Name<input name="name" value={server.name} maxlength="80" required class="border bg-background px-3 py-2" /></label>
   <details><summary class="cursor-pointer text-sm text-muted-foreground">Ports</summary><div class="mt-3 grid grid-cols-2 gap-3">
    <label class="grid gap-1.5 text-sm">Game<input name="gamePort" type="number" value={server.gamePort} min="1024" max="65535" required class="min-w-0 border bg-background px-3 py-2" /></label>
    <label class="grid gap-1.5 text-sm">RCON<input name="rconPort" type="number" value={server.rconPort} min="1024" max="65535" required class="min-w-0 border bg-background px-3 py-2" /></label>
   </div></details>
   <div class="flex justify-end"><Button type="submit" disabled={pending}><SaveIcon class="size-4" />{pending ? 'Saving…' : 'Save'}</Button></div>
  </form>
 </Dialog.Content>
</Dialog.Root>
