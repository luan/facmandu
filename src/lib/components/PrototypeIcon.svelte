<script lang="ts">
 import { BoxIcon, DropletIcon, FlaskConicalIcon, SettingsIcon } from '@lucide/svelte';
 import type { PrototypeRef } from '$lib/factory-results';
 let { prototype, serverId, large = false }: { prototype: PrototypeRef; serverId: string; large?: boolean } = $props();
 const src = $derived(`/api/servers/${encodeURIComponent(serverId)}/icons/${prototype.kind}/${encodeURIComponent(prototype.name)}`);
 let failed = $state('');
 const Fallback = $derived(prototype.kind === 'technology' ? FlaskConicalIcon : prototype.kind === 'fluid' ? DropletIcon : prototype.kind === 'recipe' ? SettingsIcon : BoxIcon);
</script>

<span class={`inline-flex shrink-0 items-center justify-center ${large ? 'size-12' : 'size-5'}`} aria-hidden="true">
 {#if failed !== src}<img {src} alt="" width="64" height="64" loading="lazy" decoding="async" class="size-full object-contain" onerror={() => { failed = src; }} />
 {:else}<Fallback class={large ? 'size-6 text-muted-foreground' : 'size-4 text-muted-foreground'} />{/if}
</span>
