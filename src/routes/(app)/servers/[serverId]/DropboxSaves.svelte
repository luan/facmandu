<script lang="ts">
 import { CloudIcon, RefreshCwIcon, DownloadIcon, UploadIcon } from '@lucide/svelte';
 import { toast } from 'svelte-sonner';
 import Button from '$lib/components/ui/button/button.svelte';
 import * as Dialog from '$lib/components/ui/dialog';
 import { getActivityState } from '$lib/activity.svelte';
 import type { CloudSave } from '$lib/server/dropbox-backups';
 let { serverId, running, busyReason }: { serverId: string; running: boolean; busyReason: string } = $props();
 let connected = $state(false);
 let configured = $state(false);
 let loading = $state(true);
 let pending = $state(false);
 let message = $state('');
 let saves = $state<CloudSave[]>([]);
 let cursor = $state<string | null>(null);
 let restore = $state<CloudSave | null>(null);
 const activity = getActivityState();
 const completed = $derived(activity.items.find(item => item.scope === 'server' && item.targetId === serverId && item.task === 'cloud-save' && item.state !== 'running')?.updatedAt);
 const reason = $derived(busyReason || (running ? 'Stop the server before transferring saves' : ''));
 async function load(more = false) {
  loading = true; message = '';
  try {
   const response = await fetch(`/servers/${serverId}/cloud${more && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
   const data: { connected?: boolean; configured?: boolean; saves: CloudSave[]; cursor: string | null; message?: string } = await response.json();
   connected = data.connected ?? connected; configured = data.configured ?? configured;
   if (!response.ok) throw new Error(data.message || 'Could not load Dropbox backups');
   saves = more ? [...saves, ...data.saves] : data.saves; cursor = data.cursor;
  } catch (cause) { message = cause instanceof Error ? cause.message : 'Could not load Dropbox backups'; }
  finally { loading = false; }
 }
 $effect(() => { void serverId; void completed; void load(); });
 async function transfer(operation: 'backup' | 'restore' | 'disconnect') {
  if (pending || busyReason || (operation !== 'disconnect' && running)) return;
  pending = true;
  try {
   const body = new FormData(); body.set('operation', operation);
   if (restore) body.set('save', JSON.stringify(restore));
   const response = await fetch(`/servers/${serverId}/cloud`, { method: 'POST', body, headers: { Accept: 'application/json' } });
   const data: { message?: string } = await response.json();
   if (!response.ok) throw new Error(data.message || 'Could not start cloud transfer');
   restore = null;
   toast.success(data.message || 'Cloud transfer started. Follow progress in Activity.');
   if (operation === 'disconnect') await load();
  } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Cloud transfer failed'); }
  finally { pending = false; }
 }
</script>
<section class="mt-6 border border-border" aria-label="Dropbox backups">
 <div class="flex flex-wrap items-center justify-between gap-3 border-b p-3">
  <h2 class="inline-flex items-center gap-2 font-semibold"><CloudIcon class="size-4" />Dropbox backups</h2>
  <div class="flex flex-wrap items-center gap-2">
   {#if connected}
    <Button size="sm" variant="outline" disabled={!!reason || pending} onclick={() => void transfer('backup')} title={reason}><UploadIcon class="size-4" />Back up current world</Button>
    <Button size="sm" variant="ghost" disabled={pending || !!busyReason} onclick={() => void transfer('disconnect')}>Disconnect</Button>
   {:else if configured}
    <form method="POST" action={`/api/dropbox/start?serverId=${encodeURIComponent(serverId)}`}><Button size="sm" type="submit">Connect Dropbox</Button></form>
   {/if}
   <Button size="sm" variant="ghost" disabled={loading} onclick={() => void load()} aria-label="Refresh Dropbox backups"><RefreshCwIcon class="size-4" /></Button>
  </div>
 </div>
 <div class="space-y-3 p-3 text-sm">
  <p class="text-muted-foreground">Versioned copies in your Facmandu Dropbox folder. Transfers require a stopped server. Restoring preserves the current world and selects a separate save for the next start; mods and mod settings stay as configured.</p>
  {#if loading}<p role="status">Loading Dropbox backups…</p>
  {:else if message}<p role="alert" class="text-destructive">{message}</p>{#if connected}<form method="POST" action={`/api/dropbox/start?serverId=${encodeURIComponent(serverId)}`}><Button type="submit" size="sm" variant="outline">Reconnect Dropbox</Button></form>{/if}
  {:else if !configured}<p>Dropbox setup is not configured on this host.</p>
  {:else if !connected}<p>Connect your Dropbox account to back up and restore this server’s saves.</p>
  {:else}
   <ul class="divide-y divide-border">
    {#each saves as save (save.path_lower)}
     <li class="flex items-center gap-3 py-3">
      <div class="min-w-0 flex-1"><p class="break-all font-medium">{save.name}</p><p class="text-muted-foreground">{new Date(save.server_modified).toLocaleString()} · {(save.size / 1024 / 1024).toFixed(1)} MB</p></div>
      <Button variant="outline" size="sm" disabled={!!reason || pending} title={reason} onclick={() => restore = save}><DownloadIcon class="size-4" />Restore</Button>
     </li>
    {:else}<li class="py-2 text-muted-foreground">No cloud backups for this server yet.</li>{/each}
   </ul>
   {#if cursor}<Button size="sm" variant="outline" disabled={loading} onclick={() => void load(true)}>Load more backups</Button>{/if}
  {/if}
 </div>
</section>
<Dialog.Root open={restore !== null} onOpenChange={(open) => { if (!open && !pending) restore = null; }}>
 <Dialog.Content>
  <Dialog.Header><Dialog.Title>Restore this backup?</Dialog.Title><Dialog.Description>The current world will be kept as a local backup. This cloud copy will be downloaded as a separate save and selected for the next start. The server stays stopped.</Dialog.Description></Dialog.Header>
  {#if restore}<p class="break-all text-sm">{restore.name}</p>{/if}
  <div class="flex justify-end gap-2"><Button variant="outline" disabled={pending} onclick={() => restore = null}>Cancel</Button><Button disabled={!!reason || pending} onclick={() => void transfer('restore')}>{pending ? 'Starting…' : 'Preserve current world and restore'}</Button></div>
 </Dialog.Content>
</Dialog.Root>
