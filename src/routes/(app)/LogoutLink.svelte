<script lang="ts">
	import { enhance } from '$app/forms';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { LogOutIcon } from '@lucide/svelte';
	let pending = $state(false);
</script>

<form method="post" action="/logout" use:enhance={({ cancel }) => {
	if (pending) { cancel(); return; }
	pending = true;
	return async ({ update }) => { try { await update(); } finally { pending = false; } };
}}>
	<DropdownMenu.Item disabled={pending} closeOnSelect={false}>
		{#snippet child({ props })}<button {...props} type="submit" class={`${props.class} w-full`}><LogOutIcon />{pending ? 'Logging out…' : 'Logout'}</button>{/snippet}
	</DropdownMenu.Item>
</form>
