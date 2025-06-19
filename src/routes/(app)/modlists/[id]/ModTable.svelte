<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Badge } from '$lib/components/ui/badge';
	import { TrashIcon, RefreshCwIcon, DownloadIcon, ClockIcon } from '@lucide/svelte';
	import type { Mod } from '$lib/server/db/schema';

	interface Props {
		mods: Mod[];
		modlistName: string;
	}

	let { mods, modlistName }: Props = $props();
	let confirmDeleteId: string | null = $state(null);

	function handleDeleteClick(modId: string) {
		if (confirmDeleteId === modId) {
			confirmDeleteId = null;
		} else {
			confirmDeleteId = modId;
			setTimeout(() => {
				if (confirmDeleteId === modId) {
					confirmDeleteId = null;
				}
			}, 3000);
		}
	}

	function formatDownloads(count?: number | null): string {
		if (!count) return 'N/A';
		if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
		if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
		return count.toString();
	}

	function formatDate(date?: Date | null): string {
		if (!date) return 'N/A';
		try {
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

			if (diffDays < 1) return 'Today';
			if (diffDays < 30) return `${diffDays}d`;
			if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
			return `${Math.floor(diffDays / 365)}y`;
		} catch {
			return 'N/A';
		}
	}

	function parseTags(tagsJson?: string | null): string[] {
		if (!tagsJson) return [];
		try {
			return JSON.parse(tagsJson);
		} catch {
			return [];
		}
	}
</script>

<Tooltip.Provider>
	<Card.Root>
		<Card.Header>
			<Card.CardAction>
				<form method="POST" action="?/refreshAllMods" use:enhance>
					<Button type="submit" variant="outline" size="sm">
						<RefreshCwIcon class="mr-2 h-4 w-4" />
						Refresh All
					</Button>
				</form>
			</Card.CardAction>
			<Card.Title>Mods in {modlistName}</Card.Title>
			<Card.Description>
				{mods.length} mod{mods.length !== 1 ? 's' : ''} in this list
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if mods.length === 0}
				<div class="py-8 text-center">
					<p>No mods in this list yet.</p>
					<p class="text-sm">Use the search above to add mods.</p>
				</div>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-8"></Table.Head>
							<Table.Head class="w-12">Status</Table.Head>
							<Table.Head class="min-w-48">Mod</Table.Head>
							<Table.Head class="w-24">Category</Table.Head>
							<Table.Head class="w-20">Version</Table.Head>
							<Table.Head class="w-20">Factorio</Table.Head>
							<Table.Head class="w-20">Downloads</Table.Head>
							<Table.Head class="w-16">Updated</Table.Head>
							<Table.Head class="w-32">Tags</Table.Head>
							<Table.Head class="w-24">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each mods as mod (mod.id)}
							<Table.Row class="group">
								<!-- Thumbnail -->
								<Table.Cell class="p-2">
									{#if mod.thumbnail}
										<Tooltip.Root>
											<Tooltip.Trigger>
												<img
													src={`https://assets-mod.factorio.com${mod.thumbnail}`}
													alt={mod.title || mod.name}
													class="m-auto h-8 w-8 rounded object-cover"
													loading="lazy"
												/>
											</Tooltip.Trigger>
											<Tooltip.Content>
												<img
													src={`https://assets-mod.factorio.com${mod.thumbnail}`}
													alt={mod.title || mod.name}
													class="h-32 w-32 rounded object-cover"
													loading="lazy"
												/>
											</Tooltip.Content>
										</Tooltip.Root>
									{:else}
										<div class="bg-muted flex h-8 w-8 items-center justify-center rounded">
											<span class="text-[10px]">📦</span>
										</div>
									{/if}
								</Table.Cell>

								<!-- Status -->
								<Table.Cell class="p-2">
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
								</Table.Cell>

								<!-- Mod Info -->
								<Table.Cell class="p-2">
									<div class="space-y-1">
										<div class="font-medium">
											{#if mod.summary}
												<Tooltip.Root>
													<Tooltip.Trigger class="text-left">
														{mod.title || mod.name}
													</Tooltip.Trigger>
													<Tooltip.Content class="max-w-80">
														<div class="space-y-2">
															<p class="font-semibold">{mod.title || mod.name}</p>
															<p class="text-sm">{mod.summary}</p>
														</div>
													</Tooltip.Content>
												</Tooltip.Root>
											{:else}
												{mod.title || mod.name}
											{/if}
										</div>
										{#if mod.title && mod.title !== mod.name}
											<div class="text-muted-foreground text-xs">({mod.name})</div>
										{/if}
									</div>
								</Table.Cell>

								<!-- Category -->
								<Table.Cell class="p-2">
									{#if mod.category}
										<Badge variant="secondary" class="text-xs capitalize">
											{mod.category}
										</Badge>
									{:else}
										<span class="text-muted-foreground text-xs">N/A</span>
									{/if}
								</Table.Cell>

								<!-- Version -->
								<Table.Cell class="p-2">
									{#if mod.version}
										<code class="text-xs">{mod.version}</code>
									{:else}
										<span class="text-muted-foreground text-xs">N/A</span>
									{/if}
								</Table.Cell>

								<!-- Factorio Version -->
								<Table.Cell class="p-2">
									{#if mod.factorioVersion}
										<code class="text-xs">{mod.factorioVersion}</code>
									{:else}
										<span class="text-muted-foreground text-xs">N/A</span>
									{/if}
								</Table.Cell>

								<!-- Downloads -->
								<Table.Cell class="p-2">
									{#if mod.downloadsCount}
										<div class="flex items-center gap-1 text-xs">
											<DownloadIcon class="h-3 w-3" />
											<span>{formatDownloads(mod.downloadsCount)}</span>
										</div>
									{:else}
										<span class="text-muted-foreground text-xs">N/A</span>
									{/if}
								</Table.Cell>

								<!-- Last Updated -->
								<Table.Cell class="p-2">
									{#if mod.lastUpdated}
										<div class="text-muted-foreground flex items-center gap-1 text-xs">
											<ClockIcon class="h-3 w-3" />
											<span>{formatDate(mod.lastUpdated)}</span>
										</div>
									{:else}
										<span class="text-muted-foreground text-xs">N/A</span>
									{/if}
								</Table.Cell>

								<!-- Tags -->
								<Table.Cell class="p-2">
									{#if parseTags(mod.tags).length > 0}
										<div class="flex flex-wrap gap-1">
											{#each parseTags(mod.tags).slice(0, 2) as tag (tag)}
												<Badge variant="outline" class="px-1 py-0 text-[10px]">
													{tag}
												</Badge>
											{/each}
											{#if parseTags(mod.tags).length > 2}
												<Tooltip.Root>
													<Tooltip.Trigger>
														<Badge variant="outline" class="px-1 py-0 text-[10px]">
															+{parseTags(mod.tags).length - 2}
														</Badge>
													</Tooltip.Trigger>
													<Tooltip.Content>
														<div class="flex max-w-60 flex-wrap gap-1">
															{#each parseTags(mod.tags) as tag (tag)}
																<Badge variant="secondary" class="text-xs">
																	{tag}
																</Badge>
															{/each}
														</div>
													</Tooltip.Content>
												</Tooltip.Root>
											{/if}
										</div>
									{:else}
										<span class="text-muted-foreground text-xs">None</span>
									{/if}
								</Table.Cell>

								<!-- Actions -->
								<Table.Cell class="p-2">
									<div class="flex items-center gap-1">
										<!-- Refresh Button -->
										<form method="POST" action="?/refreshMod" use:enhance>
											<input type="hidden" name="modId" value={mod.id} />
											<input type="hidden" name="modName" value={mod.name} />
											<Tooltip.Root>
												<Tooltip.Trigger>
													<Button type="submit" variant="ghost" size="sm" class="h-6 w-6 p-0">
														<RefreshCwIcon class="h-3 w-3" />
													</Button>
												</Tooltip.Trigger>
												<Tooltip.Content>
													<p>Refresh mod info</p>
													{#if mod.lastFetched}
														<p class="text-muted-foreground text-xs">
															Last: {formatDate(mod.lastFetched)}
														</p>
													{/if}
												</Tooltip.Content>
											</Tooltip.Root>
										</form>

										<!-- Delete Button -->
										{#if confirmDeleteId === mod.id}
											<form method="POST" action="?/removeMod" use:enhance>
												<input type="hidden" name="modName" value={mod.name} />
												<Tooltip.Root>
													<Tooltip.Trigger>
														<Button
															type="submit"
															variant="destructive"
															size="sm"
															class="h-6 w-6 p-0"
														>
															<TrashIcon class="h-3 w-3" />
														</Button>
													</Tooltip.Trigger>
													<Tooltip.Content>
														<p>Confirm deletion</p>
													</Tooltip.Content>
												</Tooltip.Root>
											</form>
										{:else}
											<Tooltip.Root>
												<Tooltip.Trigger>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														class="h-6 w-6 p-0"
														disabled={mod.enabled}
														onclick={() => handleDeleteClick(mod.id)}
													>
														<TrashIcon class="h-3 w-3" />
													</Button>
												</Tooltip.Trigger>
												<Tooltip.Content>
													<p>
														{mod.enabled ? 'Disable mod first to remove it' : 'Click to remove mod'}
													</p>
												</Tooltip.Content>
											</Tooltip.Root>
										{/if}
									</div>

									<!-- Error indicator -->
									{#if mod.fetchError}
										<Tooltip.Root>
											<Tooltip.Trigger>
												<div class="text-destructive mt-1 text-xs">⚠️</div>
											</Tooltip.Trigger>
											<Tooltip.Content class="max-w-60">
												<p class="text-xs">Error: {mod.fetchError}</p>
											</Tooltip.Content>
										</Tooltip.Root>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>
</Tooltip.Provider>
