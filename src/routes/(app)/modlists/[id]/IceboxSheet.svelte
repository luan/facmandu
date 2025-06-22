<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { buttonVariants } from '$lib/components/ui/button';
	import Button from '$lib/components/ui/button/button.svelte';
	import { PackageIcon, ClockIcon, DownloadIcon, NutIcon, PlusIcon, XIcon } from '@lucide/svelte';
	import type { Mod } from '$lib/server/db/schema';
	import ModPreviewSheet from './ModPreviewSheet.svelte';
	import { enhance } from '$app/forms';

	type IceboxMod = Omit<Mod, 'updatedBy'> & {
		updatedBy: { id: string; username?: string } | string | null;
	};

	interface Props {
		iceboxMods: IceboxMod[];
	}

	let { iceboxMods }: Props = $props();

	// Map to hold extra details fetched from API when missing
	let modDetails = $state<
		Record<string, Partial<Mod & { owner?: string; downloads_count?: number; updated_at?: string }>>
	>({});

	const PREFETCH_COUNT = 12;
	$effect(() => {
		for (const mod of iceboxMods.slice(0, PREFETCH_COUNT)) {
			if (!mod.title) {
				fetchDetails(mod.name);
			}
		}
	});

	function onVisible(node: HTMLElement, modName: string) {
		if (modDetails[modName]) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					fetchDetails(modName);
					observer.disconnect();
				}
			},
			{ rootMargin: '400px 0px 400px 0px' }
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			}
		};
	}

	async function fetchDetails(modName: string) {
		if (modDetails[modName]) return;
		try {
			const res = await fetch(`/api/factorio-mods/${modName}`);
			if (!res.ok) return;
			const data = await res.json();
			const latest = data.releases?.[data.releases.length - 1] ?? {};
			modDetails[modName] = {
				title: data.title,
				summary: data.summary,
				description: data.description,
				thumbnail: data.thumbnail,
				owner: data.owner,
				category: data.category,
				tags: data.tags,
				downloads_count: data.downloads_count,
				updated_at: data.updated_at,
				version: latest.version
			};
		} catch {
			// ignore
		}
	}

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
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
		return count.toString();
	}

	function getUsername(u: IceboxMod['updatedBy']): string | null {
		if (u && typeof u === 'object' && 'username' in u && u.username) {
			return (u as { username: string }).username;
		}
		return null;
	}

	// preview state
	let previewOpen = $state(false);
	let previewModName = $state<string | null>(null);
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

<Sheet.Root>
	<Sheet.Trigger class={buttonVariants({ variant: 'outline', size: 'sm' })}>
		<PackageIcon class="mr-2 h-4 w-4" /> Icebox ({iceboxMods.length})
	</Sheet.Trigger>

	<Sheet.Content side="right" class="w-[800px] !max-w-[800px] sm:w-[800px]">
		<Sheet.Header>
			<Sheet.Title>Icebox Mods</Sheet.Title>
			<Sheet.Description>Mods added for later triage.</Sheet.Description>
		</Sheet.Header>

		<div class="space-y-6 overflow-y-auto p-4">
			{#if iceboxMods.length === 0}
				<p>No mods in icebox.</p>
			{:else}
				{#each iceboxMods as mod (mod.id)}
					<div
						use:onVisible={mod.name}
						class="hover:bg-muted/50 flex gap-4 rounded-lg border p-4 transition-colors"
					>
						<!-- Thumbnail -->
						<div class="flex-shrink-0">
							{#if mod.thumbnail || modDetails[mod.name]?.thumbnail}
								<img
									src={`https://assets-mod.factorio.com${mod.thumbnail ?? modDetails[mod.name]?.thumbnail}`}
									alt={mod.title ?? modDetails[mod.name]?.title ?? mod.name}
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
							<div class="mb-1">
								<a
									href={`https://mods.factorio.com/mod/${mod.name}`}
									class="text-foreground truncate text-left text-lg font-semibold"
									onclick={(e) => {
										if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
											e.preventDefault();
											openModPreview(mod.name);
										}
									}}
								>
									{mod.title ?? modDetails[mod.name]?.title ?? mod.name}
								</a>
								{#if modDetails[mod.name]?.owner}
									<p class="text-muted-foreground flex items-center gap-1 text-sm">
										<span>by</span>
										<span class="text-accent font-medium">{modDetails[mod.name].owner}</span>
									</p>
								{/if}
							</div>

							{#if mod.summary ?? modDetails[mod.name]?.summary}
								<p class="text-muted-foreground mb-3 line-clamp-2 text-sm">
									{mod.summary ?? modDetails[mod.name]?.summary}
								</p>
							{/if}

							{#if getUsername(mod.updatedBy)}
								<p class="text-muted-foreground mb-2 text-xs">
									Added by {getUsername(mod.updatedBy)}
								</p>
							{/if}

							<!-- Metadata -->
							<div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-4 text-xs">
								{#if mod.category ?? modDetails[mod.name]?.category}
									<div class="flex items-center gap-1">
										<NutIcon class="h-3 w-3" />
										<span class="capitalize">{mod.category ?? modDetails[mod.name]?.category}</span>
									</div>
								{/if}
								{#if modDetails[mod.name]?.updated_at}
									<div class="flex items-center gap-1">
										<ClockIcon class="h-3 w-3" />
										<span>{formatDate(modDetails[mod.name].updated_at)}</span>
									</div>
								{/if}
								{#if modDetails[mod.name]?.version}
									<div class="flex items-center gap-1">
										<span class="text-green-500">🏷️</span>
										<span>{modDetails[mod.name].version}</span>
									</div>
								{/if}
								{#if (modDetails[mod.name]?.downloads_count ?? 0) > 0}
									<div class="flex items-center gap-1">
										<DownloadIcon class="h-3 w-3" />
										<span>{formatDownloads(modDetails[mod.name].downloads_count)}</span>
									</div>
								{/if}
							</div>
						</div>

						<!-- Actions -->
						<div class="flex flex-shrink-0 flex-col items-start gap-2">
							<form method="POST" action="?/activateMod" use:enhance>
								<input type="hidden" name="modId" value={mod.id} />
								<Button type="submit" size="sm" variant="success">
									<PlusIcon class="mr-1 h-3 w-3" />
									Add to List
								</Button>
							</form>
							<form method="POST" action="?/removeMod" use:enhance>
								<input type="hidden" name="modName" value={mod.name} />
								<Button type="submit" size="sm" variant="destructive">
									<XIcon class="mr-1 h-3 w-3" />
									Remove
								</Button>
							</form>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<ModPreviewSheet bind:open={previewOpen} modName={previewModName} />

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
