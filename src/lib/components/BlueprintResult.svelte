<script lang="ts">
 import type { BlueprintArtifact } from '$lib/blueprints';
 import { CopyIcon, DownloadIcon, CheckIcon } from '@lucide/svelte';
 import Button from './ui/button/button.svelte';
 let { blueprint }: {blueprint:BlueprintArtifact} = $props();
 let copied=$state(false);
 let error=$state('');
 const bounds=$derived({
  left:Math.min(...blueprint.entities.map(e=>e.position.x-e.width/2))-1,
  top:Math.min(...blueprint.entities.map(e=>e.position.y-e.height/2))-1,
  right:Math.max(...blueprint.entities.map(e=>e.position.x+e.width/2))+1,
  bottom:Math.max(...blueprint.entities.map(e=>e.position.y+e.height/2))+1
 });
 async function copy() {try {await navigator.clipboard.writeText(blueprint.blueprint);copied=true;error='';}catch{error='Could not copy blueprint. Download it instead.';}}
 function download() {
  const url=URL.createObjectURL(new Blob([blueprint.blueprint],{type:'text/plain'}));
  const link=document.createElement('a');link.href=url;link.download='blueprint.txt';link.click();URL.revokeObjectURL(url);
 }
</script>
<section class="overflow-hidden border border-border bg-white/[0.025] text-sm" aria-label={blueprint.label}>
 <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3"><h3 class="font-semibold">{blueprint.label}</h3><span class="text-xs text-muted-foreground">{blueprint.entities.length} entities · Native blueprint</span></header>
 <svg class="h-80 w-full bg-black/20" viewBox={`${bounds.left} ${bounds.top} ${bounds.right-bounds.left} ${bounds.bottom-bounds.top}`} role="img" aria-label={`Layout for ${blueprint.label}`}>
  {#each blueprint.entities as entity}
   <g><title>{entity.name}{entity.recipe ? ` · ${entity.recipe}` : ''} · {entity.position.x}, {entity.position.y}</title>
    <rect x={entity.position.x-entity.width/2+0.03} y={entity.position.y-entity.height/2+0.03} width={entity.width-0.06} height={entity.height-0.06} fill={entity.recipe ? '#c58e36' : entity.name.includes('belt') ? '#8c793d' : entity.name.includes('pipe') ? '#6b8fa4' : '#737373'} stroke="#d9d1bd" stroke-width="0.04" />
    <path d="M -0.16 0.1 L 0 -0.16 L 0.16 0.1" fill="none" stroke="#ffffff" stroke-width="0.065" transform={`translate(${entity.position.x},${entity.position.y}) rotate(${entity.direction*22.5})`} />
   </g>
  {/each}
 </svg>
 <div class="space-y-3 border-t border-border p-3">
  <p class="text-xs text-muted-foreground">Validated by this server’s Factorio engine. Hover over an entity to inspect it. Export validation does not verify throughput or supply connections.</p>
  <details><summary class="cursor-pointer text-xs">Construction materials</summary><ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{#each blueprint.cost as item}<li>{item.count} × {item.name}</li>{/each}</ul></details>
  <div class="flex gap-2"><Button size="sm" onclick={() => void copy()}>{#if copied}<CheckIcon />{:else}<CopyIcon />{/if}Copy blueprint</Button><Button size="sm" variant="outline" onclick={download}><DownloadIcon />Download</Button></div>
  {#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
 </div>
</section>
