<script lang="ts">
 import type { Snippet } from 'svelte';
 let { summary, children, class: className = '', summaryClass = '' }: { summary: Snippet; children: Snippet; class?: string; summaryClass?: string } = $props();
 let open = $state(false);
</script>
<details class={className} ontoggle={event => open = event.currentTarget.open}>
 <summary class={summaryClass}>{@render summary()}</summary>
 {#if open}{@render children()}{/if}
</details>
