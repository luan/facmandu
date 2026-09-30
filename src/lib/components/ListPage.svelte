<script lang="ts">
 import type { Snippet } from 'svelte';
 import { PlusIcon, SearchIcon } from '@lucide/svelte';
 import Button from '$lib/components/ui/button/button.svelte';
 let { title, createHref, createLabel, searchLabel, query = $bindable(''), columns, children, empty, emptyMessage, context }: {
  title:string; createHref:string; createLabel:string; searchLabel:string; query?:string;
  columns:[string,string,string]; children:Snippet; empty:boolean; emptyMessage:string; context?:Snippet;
 } = $props();
</script>
<div class="workbench collection">
 <div class="window-title flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-xl font-semibold">{title}</h1>
  <div class="collection-tools">
   {#if !empty}<label class="relative min-w-0"><SearchIcon class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input aria-label={searchLabel} placeholder={`${searchLabel}…`} bind:value={query} class="w-full border bg-background py-1.5 pl-8 pr-2 text-sm" /></label>{/if}
   <Button href={createHref} size="sm"><PlusIcon class="size-4" />{createLabel}</Button>
  </div>
 </div>
 <div class="factory-panel overflow-hidden border-t-0">
  {#if context}<div class="border-b px-4 py-2 text-sm">{@render context()}</div>{/if}
  {#if empty}<p class="px-4 py-8 text-sm text-muted-foreground">{emptyMessage}</p>
  {:else}
   <div class="collection-columns text-muted-foreground bg-muted/30 border-b px-4 py-2 text-xs">{#each columns as column}<span>{column}</span>{/each}<span class="text-right">Actions</span></div>
   <ul class="divide-y">{@render children()}</ul>
  {/if}
 </div>
</div>
<style>
 .collection { max-width:1152px; }
 .collection-tools { display:flex; align-items:center; gap:12px; }
 .collection-tools label { width:224px; }
 .collection-columns { display:grid; grid-template-columns:minmax(0,1fr) 5rem 6rem 5rem; align-items:center; gap:16px; }
 .collection :global(.collection-row) { display:grid; grid-template-columns:minmax(0,1fr) 5rem 6rem 5rem; align-items:center; gap:8px 16px; min-width:0; min-height:68px; padding:4px 16px; }
 .collection :global(.collection-row:hover) { background:#ffffff05; }
 .collection :global(.collection-link) { display:block; min-width:0; padding-block:9px; }
 .collection :global(.collection-link:hover h2) { color:var(--primary); text-decoration:underline; text-underline-offset:3px; }
 .collection :global(.collection-link:focus-visible) { outline:2px solid var(--primary); outline-offset:3px; }
 @media(max-width:767px) {
  .collection-columns { display:none; }
  .collection :global(.collection-row) { grid-template-columns:minmax(0,1fr) auto; }
 }
 @media(max-width:540px) {
  .collection-tools { width:100%; }
  .collection-tools label { flex:1; width:auto; }
 }
</style>
