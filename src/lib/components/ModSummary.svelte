<script lang="ts">
 import { PackageIcon } from '@lucide/svelte';
 import { modThumbnailUrl } from '$lib/utils';
 import type { Snippet } from 'svelte';
 let { name, title, thumbnail, owner, version, summary, preview, children }: {
  name: string; title?: string | null; thumbnail?: string | null; owner?: string | null;
  version?: string | null; summary?: string | null; preview?: () => void; children?: Snippet;
 } = $props();
</script>
<div class="flex min-w-0 gap-3">
 <div class="flex size-16 shrink-0 items-center justify-center bg-background/40">
  {#if thumbnail}<img src={modThumbnailUrl(thumbnail)} alt="" class="size-full object-contain" loading="lazy" />{:else}<PackageIcon class="size-7 text-muted-foreground" />{/if}
 </div>
 <div class="min-w-0 flex-1 space-y-1">
  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
   {#if preview}<button type="button" class="text-left text-sm font-semibold text-primary hover:underline" onclick={preview}>{title || name}</button>{:else}<span class="text-sm font-semibold">{title || name}</span>{/if}
   {#if version}<span class="text-xs text-muted-foreground">v{version}</span>{/if}
  </div>
  {#if owner}<p class="text-xs text-muted-foreground">by {owner}</p>{/if}
  {#if summary}<p class="line-clamp-2 text-sm text-muted-foreground">{summary}</p>{/if}
  {#if children}{@render children()}{/if}
 </div>
</div>
