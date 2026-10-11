<script lang="ts">
 import { factoryImageUrl, type FactoryImage } from '$lib/factory-images';
 import { ZoomInIcon, ZoomOutIcon, RotateCcwIcon } from '@lucide/svelte';
 import TooltipButton from './ui/button/tooltip-button.svelte';
 let { image, serverId, label }: {image:FactoryImage | Pick<FactoryImage,'id'>;serverId:string;label:string}=$props();
 let zoom=$state(1); let unavailable=$state(false); let ready=$state(false);
 $effect(()=>{
  const url=factoryImageUrl(serverId,image);const known='width' in image;zoom=1;unavailable=false;ready=known;
  if(known) return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout> | undefined;
  async function check(){
   try{
    const response=await fetch(url,{method:'HEAD',signal:controller.signal});
    if(controller.signal.aborted) return;
    if(response.ok) ready=true;
    else if(response.status===425) timer=setTimeout(check,2000);
    else unavailable=true;
   }catch{if(!controller.signal.aborted) unavailable=true;}
  }
  void check();
  return ()=>{controller.abort();clearTimeout(timer);};
 });
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
  {#if unavailable}<p role="alert" class="p-4 text-sm text-muted-foreground">This image is unavailable. Capture another factory view.</p>{:else if !ready}<p role="status" class="p-4 text-sm text-muted-foreground">Rendering factory view…</p>{:else}
  <img loading="lazy" src={factoryImageUrl(serverId,image)} alt={label} width={'width' in image ? image.width : undefined} height={'height' in image ? image.height : undefined} style={`width:${zoom*100}%;max-width:none;height:auto;image-rendering:pixelated`} onerror={()=>unavailable=true} />
  {/if}
 </section>
 <div class="border-t border-border px-3 py-2 text-xs text-muted-foreground"><a class="text-primary" href={factoryImageUrl(serverId,image)} target="_blank" rel="noopener noreferrer">Open full image</a></div>
</div>
