<script lang="ts">
 import { toast } from 'svelte-sonner';
 import { enhance } from '$app/forms';
 import { PlusIcon, ShieldIcon, XIcon, CopyIcon } from '@lucide/svelte';
 import { Button } from '$lib/components/ui/button';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import type { SubmitFunction } from '@sveltejs/kit';
 import type { PageProps } from './$types';
 let { data, form }: PageProps = $props();
 let pending = $state(false);

 let copied = $state(false);
 const submit: SubmitFunction = () => {
  pending = true;  copied = false;
  return async ({ result, update }) => {
   try { if (result.type === 'error') toast.error(result.error.message ?? 'Request failed'); else await update(); }
   finally { pending = false; }
  };
 };
</script>
<svelte:head><title>Administration · Facmandu</title></svelte:head>
<div class="workbench !max-w-3xl space-y-4">
 <header class="window-title"><h1 class="flex items-center gap-2 text-xl font-semibold"><ShieldIcon />Administration</h1></header>
 <section class="factory-panel p-4 space-y-3">
  <div class="flex items-center justify-between gap-3"><h2 class="text-lg font-semibold">Invitations</h2><form method="POST" action="?/invite" use:enhance={submit}><Button type="submit" disabled={pending}><PlusIcon />Create invite</Button></form></div>
  {#if form?.code}<div class="inset-panel p-3 space-y-2"><p>Single use · expires in 7 days</p><code class="break-all select-all">{form.code}</code><Button variant="secondary" onclick={async () => { try { await navigator.clipboard.writeText(form.code ?? ''); copied = true; } catch { toast.error('Select and copy the code above'); } }}><CopyIcon />{copied ? 'Copied' : 'Copy code'}</Button></div>{/if}
  {#each data.invites as invitation (invitation.hash)}
   <div class="flex items-center justify-between border-t border-border py-2 text-sm"><span>{new Date(invitation.createdAt).toLocaleDateString()} · {invitation.usedBy ? `Used by ${data.users.find(user => user.id === invitation.usedBy)?.username ?? 'user'}` : invitation.revoked ? 'Revoked' : new Date(invitation.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Available'}</span>
    {#if !invitation.usedBy && !invitation.revoked && new Date(invitation.expiresAt).getTime() > Date.now()}<form method="POST" action="?/revoke" use:enhance={submit}><input type="hidden" name="id" value={invitation.hash} /><Button type="submit" size="sm" variant="secondary" disabled={pending}><XIcon />Revoke</Button></form>{/if}
   </div>
  {:else}<p class="text-sm text-muted-foreground">No invitations yet.</p>{/each}
 </section>
 <section class="factory-panel p-4"><h2 class="text-lg font-semibold mb-3">Users</h2>
 {#each data.users as user (user.id)}<form method="POST" action="?/role" use:enhance={submit} class="flex items-center justify-between border-t border-border py-2 gap-3"><span>{user.username}</span><input type="hidden" name="id" value={user.id} /><input type="hidden" name="admin" value={String(!user.isAdmin)} /><TooltipButton type="submit" variant="secondary" size="sm" disabled={pending || (user.isAdmin && data.users.filter(item => item.isAdmin).length === 1)} tooltip={user.isAdmin && data.users.filter(item => item.isAdmin).length === 1 ? 'Keep at least one administrator' : user.isAdmin ? 'Remove administrator role' : 'Grant administrator role'}><ShieldIcon />{user.isAdmin ? 'Remove admin' : 'Make admin'}</TooltipButton></form>{/each}
 </section>
</div>
