<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { LogOutIcon } from '@lucide/svelte';
	import type { LayoutServerData } from './$types';

	let { data }: { data: LayoutServerData } = $props();
</script>

<div class="flex flex-col gap-4 p-4">
	<h1>Hi, {data.user.username}!</h1>
	<p>Your user ID is {data.user.id}.</p>

	<h1>Welcome to the app</h1>
	<p>You <a href="/settings">are logged in as {data.user.username}</a></p>

	<form method="post" action="/logout">
		<Button type="submit" variant="secondary">
			<LogOutIcon />
			Logout</Button
		>
	</form>
</div>
