<script lang="ts">
 import type { BlueprintArtifact } from '$lib/blueprints';
 import { CopyIcon, DownloadIcon, CheckIcon } from '@lucide/svelte';
 import Button from './ui/button/button.svelte';
 import FactoryImage from './FactoryImage.svelte';
 import { factoryImageSchema, factoryImagePendingSchema, type FactoryImage as ImageData } from '$lib/factory-images';
 let { blueprint, serverId, unfinished = false }: {blueprint:BlueprintArtifact;serverId?:string;unfinished?:boolean} = $props();
 let rendered=$state<ImageData | {id:string;pending:true}>();
 $effect(()=>{blueprint.blueprint;rendered=undefined;error='';});
 let rendering=$state(false);
 const image=$derived(rendered??blueprint.image);
 async function render() { if(!serverId)return;rendering=true;error='';try{const response=await fetch(`/api/servers/${encodeURIComponent(serverId)}/images`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({blueprint:blueprint.blueprint})});if(!response.ok)throw new Error(response.status===425?'Sprites are preparing. Follow Activity, then retry.':'Could not render this layout. Check the renderer’s supported mod sprites.');rendered=(response.status===202?factoryImagePendingSchema:factoryImageSchema).parse(await response.json());}catch(cause){error=cause instanceof Error?cause.message:'Could not render preview';}finally{rendering=false;}}
 let copied=$state(false);
 let error=$state('');
 const footprint=$derived([...blueprint.entities,...blueprint.tiles.map(tile=>({position:{x:tile.position.x+0.5,y:tile.position.y+0.5},width:1,height:1}))]);
 const bounds=$derived({
  left:Math.min(...footprint.map(e=>e.position.x-e.width/2))-1,
  top:Math.min(...footprint.map(e=>e.position.y-e.height/2))-1,
  right:Math.max(...footprint.map(e=>e.position.x+e.width/2))+1,
  bottom:Math.max(...footprint.map(e=>e.position.y+e.height/2))+1
 });
 async function copy() {try {await navigator.clipboard.writeText(blueprint.blueprint);copied=true;error='';}catch{error='Could not copy blueprint. Download it instead.';}}
 function download() {
  const url=URL.createObjectURL(new Blob([blueprint.blueprint],{type:'text/plain'}));
  const link=document.createElement('a');link.href=url;link.download='blueprint.txt';link.click();URL.revokeObjectURL(url);
 }
</script>
<section class="overflow-hidden border border-border bg-white/[0.025] text-sm" aria-label={blueprint.label}>
 <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3"><h3 class="font-semibold">{unfinished ? 'Saved draft' : 'Blueprint design'} · {blueprint.label}</h3><span class="text-xs text-muted-foreground">{blueprint.entities.length} entities{blueprint.tiles.length ? ` · ${blueprint.tiles.length} construction tiles` : ''} · Native blueprint</span></header>
 {#if image && serverId}<FactoryImage {image} {serverId} label={`Sprite layout for ${blueprint.label}`} onretry={()=>void render()} retrying={rendering} />{:else}
 {#if !unfinished}<svg class="h-80 w-full bg-black/20" viewBox={`${bounds.left} ${bounds.top} ${bounds.right-bounds.left} ${bounds.bottom-bounds.top}`} role="img" aria-label={`Layout for ${blueprint.label}`}>
  {#each blueprint.tiles as tile}<rect x={tile.position.x} y={tile.position.y} width="1" height="1" fill="#414141" stroke="#737373" stroke-width="0.04"><title>{tile.name}</title></rect>{/each}
  {#each blueprint.entities as entity}
   <g><title>{entity.name}{entity.recipe ? ` · ${entity.recipe}` : ''} · {entity.position.x}, {entity.position.y}</title>
    <rect x={entity.position.x-entity.width/2+0.03} y={entity.position.y-entity.height/2+0.03} width={entity.width-0.06} height={entity.height-0.06} fill={entity.recipe ? '#c58e36' : entity.name.includes('belt') ? '#8c793d' : entity.name.includes('pipe') ? '#6b8fa4' : '#737373'} stroke="#d9d1bd" stroke-width="0.04" />
    <path d="M -0.16 0.1 L 0 -0.16 L 0.16 0.1" fill="none" stroke="#ffffff" stroke-width="0.065" transform={`translate(${entity.position.x},${entity.position.y}) rotate(${entity.direction*22.5})`} />
   </g>
  {/each}
 </svg>{/if}
 {#if blueprint.renderError}<p class="px-3 pt-3 text-xs text-amber-200">{blueprint.renderError}</p>{/if}
 {#if serverId}<div class="p-3"><Button size="sm" disabled={rendering} onclick={()=>void render()}>{rendering?'Rendering sprites…':'Render sprite preview'}</Button></div>{/if}
 {/if}
 <div class="space-y-3 border-t border-border p-3">
  <p class="text-xs text-muted-foreground">{unfinished ? 'Unfinished design. Native import passed; connections and operation are not verified.' : 'Native import validated · Design preview'}</p>
  {#if blueprint.warnings.length}<details><summary class="cursor-pointer text-xs text-amber-200">{blueprint.warnings.length} design {blueprint.warnings.length === 1 ? 'check' : 'checks'}</summary><ul class="mt-2 space-y-1 text-xs text-amber-200">{#each blueprint.warnings as warning}<li>{warning}</li>{/each}</ul></details>{/if}
  <details><summary class="cursor-pointer text-xs">Construction materials</summary><ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{#each blueprint.cost as item}<li>{item.count} × {item.name}{item.quality && item.quality !== 'normal' ? ` (${item.quality})` : ''}</li>{/each}</ul></details>
  <div class="flex gap-2"><Button size="sm" onclick={() => void copy()}>{#if copied}<CheckIcon />{:else}<CopyIcon />{/if}Copy blueprint</Button><Button size="sm" variant="outline" onclick={download}><DownloadIcon />Download</Button></div>
  {#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
 </div>
</section>
