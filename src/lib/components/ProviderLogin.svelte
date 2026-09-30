<script lang="ts">
 import { onDestroy, onMount } from 'svelte';
 import { goto, invalidateAll } from '$app/navigation';
 import { LogInIcon, XIcon, LoaderCircleIcon, RefreshCwIcon } from '@lucide/svelte';
 import { Input } from '$lib/components/ui/input';
 import { Button } from '$lib/components/ui/button';
 let {
  linking = false,
  provider,
  name,
  issuer
 }: { linking?: boolean; provider: 'codex' | 'meta' | 'copilot'; name: string; issuer: string } = $props();
 let waiting = $state(false);
 let code = $state(''); let url = $state(''); let message = $state(''); let ready = $state(false);
 let username = $state(''); let invite = $state('');
 let timer: ReturnType<typeof setTimeout> | undefined;
 let disposed = false;
 async function request(operation: string) {
  const response = await fetch(`/api/auth/${provider}`, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ operation, username, invite }) });
  const data = await response.json();
  if (!response.ok || data.message) throw new Error(data.message ?? `${name} sign-in failed`);
  return data;
 }
 async function finish() {
  waiting = true; message = '';
  try { await request('finish'); code = ''; ready = false; if (linking) await invalidateAll(); else await goto('/'); }
  catch (cause) { message = cause instanceof Error ? cause.message : 'Could not finish sign-in'; }
  finally { waiting = false; }
 }
 async function poll() {
  if (disposed) return;
  try {
   const response = await fetch(`/api/auth/${provider}`, { headers: { Accept: 'application/json' } });
   const data = await response.json();
   if (!response.ok || data.message) throw new Error(data.message ?? 'Sign-in expired');
   if (data.ready) { ready = true; waiting = false; await finish(); return; }
   if (!disposed) timer = setTimeout(poll, 2000);
  } catch (cause) { waiting = false; message = cause instanceof Error ? cause.message : 'Could not check sign-in'; }
 }
 async function start() {
  waiting = true; message = ''; ready = false;
  try { const data = await request('start'); code = data.code; url = data.url; timer = setTimeout(poll, 2000); }
  catch (cause) { waiting = false; message = cause instanceof Error ? cause.message : 'Could not start sign-in'; }
 }
 async function cancel() { clearTimeout(timer); await request('cancel').catch(() => {}); waiting = false; ready = false; code = ''; }
 onMount(() => {
  void fetch(`/api/auth/${provider}`, { headers: { Accept: 'application/json' } }).then(async response => {
   if (!response.ok || disposed) return;
   const data = await response.json();
   if (!data.code || disposed) return;
   code = data.code; url = data.url; waiting = true;
   if (data.ready) { ready = true; await finish(); }
   else timer = setTimeout(poll, 2000);
  }).catch(() => {});
 });
 onDestroy(() => { disposed = true; clearTimeout(timer); });
</script>
<div class="space-y-3">
 {#if !code}<Button type="button" variant="secondary" disabled={waiting} onclick={start}>{#if waiting}<LoaderCircleIcon class="animate-spin" />{:else}<LogInIcon />{/if}{linking ? `Connect ${name}` : `Sign in with ${name}`}</Button>
 {:else}
  <div class="inset-panel p-3 space-y-2"><p>Enter this code at {issuer}:</p><code class="text-xl font-semibold tracking-widest select-all">{code}</code><a class="block underline" href={url} target="_blank" rel="noreferrer">Open {issuer} sign-in</a></div>
  {#if ready && !linking}
   <p class="text-sm">New account? Enter your invitation and choose a username.</p>
   <label for={`${provider}-username`} class="grid gap-1">Username<Input id={`${provider}-username`} bind:value={username} autocomplete="username" maxlength={31} /></label>
   <label for={`${provider}-invite`} class="grid gap-1">Invite code<Input id={`${provider}-invite`} bind:value={invite} autocomplete="off" maxlength={100} /></label>
   <Button type="button" disabled={waiting} onclick={finish}><LogInIcon />Finish sign-in</Button>
  {:else if waiting}<p class="text-sm flex items-center gap-2"><LoaderCircleIcon class="size-4 animate-spin" />Waiting for {issuer}</p>{/if}
  {#if message && !waiting && (!ready || linking)}<Button type="button" variant="secondary" onclick={start}><RefreshCwIcon />Restart sign-in</Button>{/if}
  <Button type="button" variant="secondary" onclick={cancel}><XIcon />Cancel</Button>
 {/if}
 {#if message}<p role="alert" class="text-sm text-destructive">{message}</p>{/if}
</div>
