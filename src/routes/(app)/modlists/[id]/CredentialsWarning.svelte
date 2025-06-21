<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Factorio Credentials Required</Card.Title>
		<Card.Description>
			To search for mods, you need to configure your Factorio username and token in your settings.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<Button variant="outline" onclick={() => (window.location.href = '/settings')}>
			Go to Settings
		</Button>
	</Card.Content>
</Card.Root>
