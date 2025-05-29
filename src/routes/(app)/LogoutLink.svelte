<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { LogOutIcon } from '@lucide/svelte';
</script>

<form method="post" action="/logout">
	<Button type="submit" variant="ghost">
		<LogOutIcon />
		Logout</Button
	>
</form>
