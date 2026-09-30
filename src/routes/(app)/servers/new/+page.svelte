<script lang="ts">
 import { enhance } from '$app/forms';
 import { PlusIcon, LoaderCircleIcon } from '@lucide/svelte';
 import Button from '$lib/components/ui/button/button.svelte';
 let pending = $state(false);
 const inputClass = 'border-input bg-background w-full border px-3 py-2 text-sm';
</script>
<svelte:head><title>New server · Facmandu</title></svelte:head>
<section class="workbench !max-w-xl"><div class="factory-panel">
 <div class="window-title"><h1 class="text-xl font-semibold">New server</h1></div>
 <form method="POST" use:enhance={({cancel})=>{if(pending){cancel();return;}pending=true;return async({update})=>{try{await update();}finally{pending=false;}};}} class="space-y-4 p-4">
  <label class="block space-y-1 text-sm"><span>Name</span><input name="name" required maxlength="80" class={inputClass} /></label>
  <details><summary class="cursor-pointer text-sm text-muted-foreground">Advanced</summary><div class="mt-3 grid grid-cols-2 gap-4">
   <label class="space-y-1 text-sm"><span>Game port</span><input name="gamePort" type="number" min="1024" max="65535" placeholder="Automatic" class={inputClass} /></label>
   <label class="space-y-1 text-sm"><span>RCON port</span><input name="rconPort" type="number" min="1024" max="65535" placeholder="Automatic" class={inputClass} /></label>
  </div></details>
  <Button type="submit" disabled={pending}>{#if pending}<LoaderCircleIcon class="size-4 animate-spin" />Creating…{:else}<PlusIcon class="size-4" />Create server{/if}</Button>
 </form>
</div></section>
