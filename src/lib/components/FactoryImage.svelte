<script lang="ts">
 import { factoryImageUrl, type FactoryImage } from '$lib/factory-images';
 import { ZoomInIcon, ZoomOutIcon, RotateCcwIcon } from '@lucide/svelte';
 import TooltipButton from './ui/button/tooltip-button.svelte';
 import Button from './ui/button/button.svelte';
 let { image, serverId, label, onretry, retrying=false }: {image:FactoryImage | Pick<FactoryImage,'id'>;serverId:string;label:string;onretry?:()=>void;retrying?:boolean}=$props();
 let zoom=$state(1); let unavailable=$state(false); let ready=$state(false);
 let viewportWidth=$state(0); let windowHeight=$state(800);
 let naturalWidth=$state(0); let naturalHeight=$state(0);
 const imageUrl=$derived(factoryImageUrl(serverId,image));
 const imageWidth=$derived('width' in image ? image.width : 0);
 const imageHeight=$derived('height' in image ? image.height : 0);
 const fittedWidth=$derived(naturalWidth && naturalHeight && viewportWidth ? Math.min(naturalWidth,Math.max(1,viewportWidth-32),windowHeight*0.55*naturalWidth/naturalHeight) : 0);
 $effect(()=>{
  const url=imageUrl;const known=imageWidth>0 && imageHeight>0;zoom=1;unavailable=false;ready=known;naturalWidth=imageWidth;naturalHeight=imageHeight;
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
<svelte:window bind:innerHeight={windowHeight} />
<div class="relative bg-[#282828]">
 <div class="absolute right-2 top-2 z-10 flex gap-1 border border-border bg-background p-1">
  <TooltipButton tooltip="Zoom in" variant="ghost" size="sm" disabled={zoom>=4} onclick={()=>zoom=Math.min(4,zoom+0.5)}><ZoomInIcon /></TooltipButton>
  <TooltipButton tooltip="Zoom out" variant="ghost" size="sm" disabled={zoom<=1} onclick={()=>zoom=Math.max(1,zoom-0.5)}><ZoomOutIcon /></TooltipButton>
  <TooltipButton tooltip="Fit image" variant="ghost" size="sm" onclick={()=>zoom=1}><RotateCcwIcon /></TooltipButton>
 </div>
 <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable image supports keyboard panning.) -->
 <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: allow keyboard scrolling of the zoomed image -->
 <section class="max-h-[65vh] min-h-64 overflow-auto p-4" aria-label={label} tabindex="0" bind:clientWidth={viewportWidth}>
  {#if unavailable}<div class="p-4 text-sm text-muted-foreground"><p role="alert">Preview unavailable.</p>{#if onretry}<Button size="sm" class="mt-3" disabled={retrying} onclick={onretry}>{retrying?'Rendering…':'Retry preview'}</Button>{:else}<p>Capture another factory view.</p>{/if}</div>{:else if !ready}<p role="status" class="p-4 text-sm text-muted-foreground">Rendering factory view…</p>{:else}
  <img loading="lazy" src={factoryImageUrl(serverId,image)} alt={label} width={'width' in image ? image.width : undefined} height={'height' in image ? image.height : undefined} style={`width:${fittedWidth?`${fittedWidth*zoom}px`:'auto'};max-width:${fittedWidth?'none':'100%'};height:auto;${zoom===1?'margin:0 auto;':''}image-rendering:pixelated`} onload={(event)=>{if(event.currentTarget instanceof HTMLImageElement){naturalWidth=event.currentTarget.naturalWidth;naturalHeight=event.currentTarget.naturalHeight;}}} onerror={()=>unavailable=true} />
  {/if}
 </section>
 <div class="border-t border-border px-3 py-2 text-xs text-muted-foreground"><a class="text-primary" href={factoryImageUrl(serverId,image)} target="_blank" rel="noopener noreferrer">Open full image</a></div>
</div>
