<script lang="ts">
 import { enhance } from '$app/forms';
 import { SaveIcon, ArrowLeftIcon } from '@lucide/svelte';
 import Button from '$lib/components/ui/button/button.svelte';
 let { data } = $props();
 const inputClass = 'border-input bg-background w-full border px-3 py-2 text-sm';
</script>
<svelte:head><title>{data.server.name} · Server configuration</title></svelte:head>
<div class="workbench !max-w-2xl"><a href={`/servers/${data.server.id}`} class="mb-3 inline-flex items-center gap-2 text-sm"><ArrowLeftIcon class="size-4" />{data.server.name}</a>
<section class="window-panel max-w-2xl">
 <div class="window-title"><h1 class="text-xl font-semibold">Server configuration</h1></div>
 <form method="POST" action="?/save" use:enhance class="space-y-4 p-4">
  <label class="block space-y-1 text-sm"><span>Name</span><input name="name" value={data.server.name} required maxlength="80" class={inputClass} /></label>
  <div class="grid grid-cols-2 gap-4">
   <label class="space-y-1 text-sm"><span>Game port</span><input name="gamePort" type="number" min="1024" max="65535" value={data.server.gamePort} required class={inputClass} /></label>
   <label class="space-y-1 text-sm"><span>RCON port</span><input name="rconPort" type="number" min="1024" max="65535" value={data.server.rconPort} required class={inputClass} /></label>
  </div>
  <Button type="submit"><SaveIcon class="size-4" />Save</Button>
 </form>
</section>

</div>
