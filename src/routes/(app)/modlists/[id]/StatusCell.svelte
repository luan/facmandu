<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { Mod } from '$lib/server/db/schema';

	interface Props {
		mod: Mod;
	}

	let { mod }: Props = $props();
</script>

<form method="POST" action="?/toggleStatus" use:enhance>
	<input type="hidden" name="modid" value={mod.id} />
	<Button
		type="submit"
		variant={mod.enabled ? 'default' : 'outline'}
		size="sm"
		class="h-6 px-2 text-xs"
	>
		{mod.enabled ? 'On' : 'Off'}
	</Button>
</form>
