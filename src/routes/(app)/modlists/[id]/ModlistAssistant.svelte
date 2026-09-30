<script lang="ts">
 import Assistant from '$lib/components/Assistant.svelte';
 let { listId }: { listId: string } = $props();
</script>
<Assistant {listId} />
