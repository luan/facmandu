<script lang="ts">
 import { CheckIcon, DownloadIcon, FileArchiveIcon, LoaderCircleIcon, PlusIcon, TrashIcon, UploadIcon, FolderOpenIcon } from '@lucide/svelte';
 import { enhance } from '$app/forms';
 import type { SubmitFunction } from '@sveltejs/kit';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import * as Dialog from '$lib/components/ui/dialog';
 import type { ServerView } from '$lib/server/server-view';
 import { defaultWorldGenerationSettings, type WorldGenerationSettings } from '$lib/map-generation';
 import WorldGenerationEditor from './WorldGenerationEditor.svelte';
 let { saves, selected, running, configured, busyReason, creating, action, base, serverId, submit }: {
  saves: ServerView['saves']; selected: string; running: boolean; configured: boolean;
  busyReason: string; creating: boolean; action: string; base: string; serverId: string; submit: SubmitFunction;
 } = $props();
 let dialog = $state<'create' | 'upload' | null>(null);
 let name = $state('');
 let settings = $state<WorldGenerationSettings>({ ...defaultWorldGenerationSettings });
 let file = $state<File | null>(null);
 let fileInput = $state<HTMLInputElement>();
 const sorted = $derived(saves.toSorted((a,b) => b.modTime.localeCompare(a.modTime)));
 const createReason = $derived(busyReason || (!configured ? 'Select a Factorio version in Settings' : ''));
 const fileError = $derived(file && file.size > 100 * 1024 * 1024 ? 'Save must be smaller than 100 MB' : '');
 const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
 function openCreate() {
  name = '';
  settings = { ...defaultWorldGenerationSettings, seed: crypto.getRandomValues(new Uint32Array(1))[0] };
  dialog = 'create';
 }
 const submitDialog: SubmitFunction = async (input) => {
  const complete = await submit(input);
  return async (result) => {
   if (result.result.type === 'success') { dialog = null; name = ''; file = null; }
   if (complete) await complete(result);
  };
 };
</script>
<section aria-label="Saves" class="min-w-0">
 <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <form method="POST" {action} use:enhance={submit} class="flex items-center gap-2 text-sm">
   <input type="hidden" name="operation" value="selectSave" /><input type="hidden" name="name" value="" />
   {#if selected}<TooltipButton type="submit" tooltip={busyReason || 'Load the newest save on startup'} disabled={!!busyReason} variant="ghost" size="sm"><CheckIcon class="size-4" />Use latest save</TooltipButton>{:else}<span class="inline-flex items-center gap-2 text-muted-foreground"><CheckIcon class="size-4" />Latest save on startup</span>{/if}
  </form>
  <div class="flex items-center gap-2">
   <TooltipButton tooltip={busyReason || 'Upload save'} disabled={!!busyReason} variant="outline" size="sm" onclick={() => { file = null; dialog = 'upload'; }}><UploadIcon class="size-4" />Upload</TooltipButton>
   <TooltipButton tooltip={createReason || 'Create save'} disabled={!!createReason} size="sm" onclick={openCreate}>{#if creating}<LoaderCircleIcon class="size-4 animate-spin" />Creating…{:else}<PlusIcon class="size-4" />Create save{/if}</TooltipButton>
  </div>
 </div>
 <ul class="divide-y divide-border border border-border bg-background/20">
  {#each sorted as save (save.name)}
   {@const active = selected ? save.name === selected : save.name === sorted[0]?.name}
   <li class="flex flex-wrap items-center gap-3 p-3 sm:px-4">
    <FileArchiveIcon class="size-7 shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1">
     <div class="flex flex-wrap items-baseline gap-2"><span class="break-all text-sm font-semibold">{save.name.replace(/\.zip$/u, '')}</span>{#if active}<span class="inline-flex items-center gap-1 text-xs text-primary"><CheckIcon class="size-3" />{running ? 'Next start' : 'Selected'}</span>{/if}</div>
     <div class="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{size(save.size)}</span><time datetime={save.modTime}>{new Date(save.modTime).toLocaleString()}</time></div>
    </div>
    <div class="flex items-center gap-2">
     {#if !active}<form method="POST" {action} use:enhance={submit}><input type="hidden" name="operation" value="selectSave" /><input type="hidden" name="name" value={save.name} /><TooltipButton tooltip={busyReason || 'Select save'} type="submit" disabled={!!busyReason} variant="outline" size="sm"><CheckIcon class="size-4" />Select</TooltipButton></form>{/if}
     <TooltipButton href={`${base}/saves/${encodeURIComponent(save.name)}`} download tooltip="Download save" aria-label={`Download ${save.name}`} variant="ghost" size="icon"><DownloadIcon class="size-4" /></TooltipButton>
     <form method="POST" {action} use:enhance={submit}><input type="hidden" name="operation" value="deleteSave" /><input type="hidden" name="name" value={save.name} /><TooltipButton tooltip={busyReason || (running ? 'Stop the server first' : active ? 'Select another save first' : 'Delete save')} aria-label={`Delete ${save.name}`} type="submit" disabled={!!busyReason || running || active} variant="ghost" size="icon" class="text-destructive"><TrashIcon class="size-4" /></TooltipButton></form>
    </div>
   </li>
  {:else}<li class="p-8 text-center text-sm text-muted-foreground">No saves yet</li>{/each}
 </ul>
</section>
<Dialog.Root open={dialog !== null} onOpenChange={(open) => { if (!open && !busyReason) dialog = null; }}>
 <Dialog.Content class={dialog === 'create' ? 'flex h-[92dvh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(70rem,calc(100vw-2rem))] max-h-[92dvh]' : 'sm:max-w-md'}>
  <Dialog.Header class={dialog === 'create' ? 'shrink-0 border-b border-border px-4 py-4 text-left sm:px-6' : undefined}><Dialog.Title>{dialog === 'create' ? 'Create save' : 'Upload save'}</Dialog.Title></Dialog.Header>
  {#if dialog === 'create'}
   <WorldGenerationEditor {serverId} {action} submit={submitDialog} {createReason} bind:name bind:settings />
  {:else}
   <form method="POST" {action} use:enhance={submitDialog} enctype="multipart/form-data" class="space-y-4">
    <input bind:this={fileInput} name="save" type="file" accept=".zip,application/zip" required class="sr-only" aria-label="Save file" onchange={(event) => file = event.currentTarget.files?.[0] ?? null} />
    <button type="button" class="flex w-full items-center gap-3 border border-dashed border-border p-4 text-left hover:border-primary" onclick={() => fileInput?.click()}><FolderOpenIcon class="size-6 text-primary" /><span class="min-w-0 text-sm">{file?.name || 'Choose a save'}<span class="mt-1 block text-xs text-muted-foreground">{file ? size(file.size) : 'ZIP · up to 100 MB'}</span></span></button>
    {#if fileError}<p role="alert" class="text-sm text-destructive">{fileError}</p>{/if}
    <div class="flex justify-end"><TooltipButton tooltip={busyReason || fileError || 'Upload save'} type="submit" disabled={!!busyReason || !!fileError || !file}>{#if busyReason}<LoaderCircleIcon class="size-4 animate-spin" />Uploading…{:else}<UploadIcon class="size-4" />Upload{/if}</TooltipButton></div>
   </form>
  {/if}
 </Dialog.Content>
</Dialog.Root>
