<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge';
	import Button from '$lib/components/ui/button/button.svelte';
	import { PlusIcon, ClockIcon, DownloadIcon, NutIcon, XIcon } from '@lucide/svelte';
	import { broadcastModAdded, broadcastModRemoved } from '$lib/stores/realtime.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ModPreviewSheet from './ModPreviewSheet.svelte';

	interface ModResult {
		name: string;
		title: string;
		summary?: string;
		description?: string;
		downloads_count?: number;
		owner: string;
		category?: string;
		tags?: Array<string>;
		thumbnail?: string;
		updated_at?: string;
		latest_release?: {
			version: string;
			released_at: string;
			factorio_version?: string;
		};
		score?: number;
	}

	interface Props {
		searchResults: ModResult[];
		currentMods: Array<{ name: string; id: string; enabled: boolean | null; modlist: string }>;
	}

	let { searchResults, currentMods }: Props = $props();

	// Add state for preview sheet
	let previewOpen = $state(false);
	let previewModName = $state<string | null>(null);

	function isModInList(modName: string): boolean {
		return currentMods.some((mod) => mod.name === modName);
	}

	const handleAddMod: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.success) {
				// Get the modlist ID from the first current mod (they all have the same modlist)
				const modlistId = currentMods[0]?.modlist;
				if (modlistId) {
					// Create a basic mod object for broadcasting
					const newMod = {
						id: crypto.randomUUID(), // This won't match the actual server ID, but that's okay for broadcasting
						name: result.data.modName || 'Unknown',
						enabled: true
					};
					broadcastModAdded(modlistId, newMod);
				}
			}
			// Always update the current tab
			await update();
		};
	};

	const handleRemoveMod: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.success) {
				// Get the modlist ID from the first current mod
				const modlistId = currentMods[0]?.modlist;
				if (modlistId) {
					broadcastModRemoved(modlistId, result.data.modName || 'Unknown');
				}
			}
			// Always update the current tab
			await update();
		};
	};

	function formatDate(dateString?: string): string {
		if (!dateString) return 'N/A';
		try {
			const date = new Date(dateString);
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
			const diffDays = Math.floor(diffHours / 24);

			if (diffHours < 1) return 'Less than an hour ago';
			if (diffHours < 24) return `${diffHours} hours ago`;
			if (diffDays < 30) return `${diffDays} days ago`;
			if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
			return `${Math.floor(diffDays / 365)} years ago`;
		} catch {
			return 'N/A';
		}
	}

	function formatDownloads(count?: number): string {
		if (!count) return '0';
		if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
		if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
		return count.toString();
	}

	let clearSearchUrl = new URL(page.url);
	clearSearchUrl.searchParams.delete('q');

	function openModPreview(name: string) {
		previewModName = name;
		previewOpen = true;
	}

	$effect(() => {
		if (!previewOpen) {
			previewModName = null;
		}
	});
</script>

{#if searchResults.length > 0}
	<div class="space-y-6">
		{#each searchResults as result (result.name)}
			<div class="hover:bg-muted/50 flex gap-4 rounded-lg border p-4 transition-colors">
				<!-- Mod Thumbnail -->
				<div class="flex-shrink-0">
					{#if result.thumbnail}
						<img
							src={`https://assets-mod.factorio.com${result.thumbnail}`}
							alt={result.title}
							class="bg-muted h-20 w-20 rounded-lg object-cover"
							loading="lazy"
						/>
					{:else}
						<div class="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
							<span class="text-muted-foreground text-xs">No Image</span>
						</div>
					{/if}
				</div>

				<!-- Mod Information -->
				<div class="min-w-0 flex-1">
					<!-- Title and Author -->
					<div class="mb-1">
						<a
							href={`https://mods.factorio.com/mod/${result.name}`}
							class="text-foreground truncate text-left text-lg font-semibold"
							onclick={(e) => {
								if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
									e.preventDefault();
									openModPreview(result.name);
								}
							}}
						>
							{result.title}
						</a>
						<p class="text-muted-foreground flex items-center gap-1 text-sm">
							<span>by</span>
							<span class="text-accent font-medium">{result.owner}</span>
						</p>
					</div>

					<!-- Description -->
					{#if result.summary || result.description}
						<p class="text-muted-foreground mb-3 line-clamp-2 text-sm">
							{result.summary || result.description}
						</p>
					{/if}

					<!-- Metadata Row -->
					<div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-4 text-xs">
						<!-- Content Type -->
						{#if result.category}
							<div class="flex items-center gap-1">
								<NutIcon class="h-3 w-3" />
								<span class="capitalize">{result.category}</span>
							</div>
						{/if}

						<!-- Last Updated -->
						{#if result.updated_at}
							<div class="flex items-center gap-1">
								<ClockIcon class="h-3 w-3" />
								<span>{formatDate(result.updated_at)}</span>
							</div>
						{/if}

						<!-- Version -->
						{#if result.latest_release?.version}
							<div class="flex items-center gap-1">
								<span class="text-green-500">🏷️</span>
								<span>{result.latest_release.version}</span>
							</div>
						{/if}

						<!-- Downloads -->
						<div class="flex items-center gap-1">
							<DownloadIcon class="h-3 w-3" />
							<span>{formatDownloads(result.downloads_count)}</span>
						</div>
					</div>

					<!-- Tags -->
					{#if result.tags && result.tags.length > 0}
						<div class="mb-2 flex flex-wrap gap-1">
							{#each result.tags.slice(0, 5) as tag (tag)}
								<Badge variant="secondary">{tag}</Badge>
							{/each}
							{#if result.tags.length > 5}
								<span class="bg-muted text-muted-foreground rounded-full px-2 py-1 text-xs">
									+{result.tags.length - 5} more
								</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Action Button -->
				<div class="flex flex-shrink-0 items-start">
					{#if isModInList(result.name)}
						<form method="POST" action="?/removeMod" use:enhance={handleRemoveMod}>
							<input type="hidden" name="modName" value={result.name} />
							<Button type="submit" size="sm" variant="destructive">
								<XIcon class="mr-1 h-3 w-3" />
								Remove
							</Button>
						</form>
					{:else}
						<form method="POST" action="?/addMod" use:enhance={handleAddMod}>
							<input type="hidden" name="modName" value={result.name} />
							<Button type="submit" size="sm" variant="success">
								<PlusIcon class="mr-1 h-3 w-3" />
								Add to List
							</Button>
						</form>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<ModPreviewSheet bind:open={previewOpen} modName={previewModName} />

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
