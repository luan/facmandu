<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { LogOutIcon } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import {
		Table,
		TableHeader,
		TableHead,
		TableRow,
		TableBody,
		TableCell
	} from '$lib/components/ui/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="flex flex-col gap-6 p-4">
	<h1 class="text-2xl font-semibold">Hi, {data.user.username}!</h1>

	<Card.Root>
		<Card.Header>
			<Card.Title>Your mod lists</Card.Title>
		</Card.Header>
		<Card.Content>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Collaborators</TableHead>
						<TableHead class="text-right">Mods Enabled</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.modLists as ml (ml.id)}
						<TableRow>
							<TableCell>
								<a href={`/modlists/${ml.id}`}>{ml.name}</a>
							</TableCell>
							<TableCell>
								{#if ml.collaborators?.length}
									{ml.collaborators.map((c) => c.username).join(', ')}
								{:else}
									<span class="text-muted-foreground">-</span>
								{/if}
							</TableCell>
							<TableCell class="text-right">{ml.enabledCount}/{ml.totalMods}</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card.Content>
	</Card.Root>

	<form method="post" action="/logout" class="mt-4">
		<Button type="submit" variant="secondary">
			<LogOutIcon />
			Logout</Button
		>
	</form>
</div>
