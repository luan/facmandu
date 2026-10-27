<script lang="ts">
 import type { PrototypeRef } from '#lib/factory-results.js';
 let { prototype, serverId, large = false, fallbackText }: { prototype: PrototypeRef; serverId: string; large?: boolean; fallbackText?: string } = $props();
 const src = $derived(`/api/servers/${encodeURIComponent(serverId)}/icons/${prototype.kind}/${encodeURIComponent(prototype.name)}`);
 let image = $state('');
 let failed = $state(false);
 $effect(()=>{
  const url=src;image='';failed=false;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout> | undefined;let delay=2000;
  const retry=(seconds?:number)=>{
   timer=setTimeout(()=>void load(),seconds && Number.isFinite(seconds)?Math.min(30000,Math.max(1000,seconds*1000)):delay);
   delay=Math.min(30000,delay*2);
  };
  async function load(){
   try{
    const response=await fetch(url,{method:'HEAD',signal:controller.signal});
    if(controller.signal.aborted)return;
    if([202,425,502,503,504].includes(response.status)){retry(Number(response.headers.get('Retry-After')));return;}
    if(!response.ok){failed=true;return;}
    image=url;
   }catch{if(!controller.signal.aborted)retry();}
  }
  void load();
  return ()=>{controller.abort();clearTimeout(timer);};
 });
</script>

{#if failed && fallbackText}<span>{fallbackText}</span>
{:else}<span class={`inline-flex shrink-0 items-center justify-center ${large ? 'size-12' : 'size-5'}`} aria-hidden="true" title={failed ? `Icon unavailable: ${prototype.name}` : undefined}>
 {#if image && !failed}<img src={image} alt="" width="64" height="64" decoding="async" class="size-full object-contain" onerror={() => { failed = true; }} />
 {:else if failed}<span class="text-muted-foreground">?</span>
 {:else}<span class="size-3 animate-pulse rounded-sm bg-muted motion-reduce:animate-none"></span>{/if}
</span>{/if}
