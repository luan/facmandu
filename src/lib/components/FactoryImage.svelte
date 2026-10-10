<script lang="ts">
 import { factoryImageUrl, type FactoryImage } from '$lib/factory-images';
 import { ZoomInIcon, ZoomOutIcon, RotateCcwIcon } from '@lucide/svelte';
 import TooltipButton from './ui/button/tooltip-button.svelte';
 let { image, serverId, label }: {image:FactoryImage;serverId:string;label:string}=$props();
 let zoom=$state(1); let unavailable=$state(false);
 $effect(()=>{image.id;zoom=1;unavailable=false;});
</script>
<div class="relative bg-[#282828]">
 <div class="absolute right-2 top-2 z-10 flex gap-1 border border-border bg-background p-1">
  <TooltipButton tooltip="Zoom in" variant="ghost" size="sm" disabled={zoom>=4} onclick={()=>zoom=Math.min(4,zoom+0.5)}><ZoomInIcon /></TooltipButton>
  <TooltipButton tooltip="Zoom out" variant="ghost" size="sm" disabled={zoom<=1} onclick={()=>zoom=Math.max(1,zoom-0.5)}><ZoomOutIcon /></TooltipButton>
  <TooltipButton tooltip="Fit image" variant="ghost" size="sm" onclick={()=>zoom=1}><RotateCcwIcon /></TooltipButton>
 </div>
 <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable image supports keyboard panning.) -->
 <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: allow keyboard scrolling of the zoomed image -->
 <section class="max-h-[65vh] min-h-64 overflow-auto p-4" aria-label={label} tabindex="0">
  {#if unavailable}<p role="alert" class="p-4 text-sm text-muted-foreground">This image is unavailable. Capture another factory view.</p>{:else}
  <img src={factoryImageUrl(serverId,image)} alt={label} width={image.width} height={image.height} style={`width:${zoom*100}%;max-width:none;height:auto;image-rendering:pixelated`} onerror={()=>unavailable=true} />
  {/if}
 </section>
 <div class="border-t border-border px-3 py-2 text-xs text-muted-foreground">Sprite layout · Scroll to pan · <a class="text-primary" href={factoryImageUrl(serverId,image)} target="_blank" rel="noopener noreferrer">Open full image</a></div>
</div>
