<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { BookIcon, ClockIcon, DownloadIcon, NutIcon, PlusIcon } from '@lucide/svelte';
	import type { Mod } from '$lib/server/db/schema';
	import ModPreviewSheet from './ModPreviewSheet.svelte';

	// Props: list of mods in current modlist
	interface Props {
		mods: Array<Omit<Mod, 'updatedBy'> & { updatedBy: { id: string; username: string } | null }>;
	}

	let { mods }: Props = $props();

	// ----------------- Recommendation Logic -----------------
	// Helper to parse optional dependency strings ("?" or "(?)" prefix)
	function parseOptionalDependencies(dependencyString: string | null): string[] {
		if (!dependencyString) return [];

		try {
			const deps = JSON.parse(dependencyString) as string[];
			return deps
				.map((dep) => {
					const [raw] = dep.split(/>=|>|<=|<|=/);
					let name = raw.trim();

					if (name.startsWith('(?)')) {
						name = name.slice(3).trim();
					} else if (name.startsWith('?')) {
						name = name.slice(1).trim();
					} else {
						return null;
					}

					if (!name || name.startsWith('!')) return null;

					if (name.startsWith('~')) {
						return name.slice(1).trim();
					}

					return name;
				})
				.filter((d): d is string => Boolean(d));
		} catch {
			return [];
		}
	}

	// Helper to parse conflicts from dependency string (! prefix)
	function parseConflicts(dependencyString: string | null): string[] {
		if (!dependencyString) return [];

		try {
			const deps = JSON.parse(dependencyString) as string[];
			return deps
				.map((dep) => {
					const [raw] = dep.split(/>=|>|<=|<|=/);
					let name = raw.trim();
					if (name.startsWith('!')) {
						return name.slice(1).trim();
					}
					return null;
				})
				.filter((d): d is string => Boolean(d));
		} catch {
			return [];
		}
	}

	// ----------------- Derived data -----------------
	// Set of optional dependencies across all enabled mods
	const optionalDependencySet = $derived(
		(() => {
			const deps = new Set<string>();
			const baseMods = new Set(['base', 'space-age', 'quality', 'elevated-rails']);

			for (const mod of mods) {
				if (!mod.enabled) continue;
				for (const dep of parseOptionalDependencies(mod.dependencies)) {
					if (!baseMods.has(dep)) {
						deps.add(dep);
					}
				}
			}
			return deps;
		})()
	);

	// Recommendations are optional dependencies not already present in the mod list
	const optionalRecommendations = $derived(
		(() => {
			const existing = new Set(mods.map((m) => m.name));
			return Array.from(optionalDependencySet)
				.filter((name) => !existing.has(name))
				.sort((a, b) => a.localeCompare(b));
		})()
	);

	// Map of optional dependency -> mods recommending it
	const optionalDependencyMap = $derived(
		(() => {
			const map = new Map<string, string[]>();
			const baseMods = new Set(['base', 'space-age', 'quality', 'elevated-rails']);

			for (const mod of mods) {
				if (!mod.enabled) continue;
				for (const dep of parseOptionalDependencies(mod.dependencies)) {
					if (baseMods.has(dep)) continue;
					if (!map.has(dep)) {
						map.set(dep, []);
					}
					const arr = map.get(dep)!;
					if (!arr.includes(mod.name)) arr.push(mod.name);
				}
			}
			return map;
		})()
	);

	// Map of mod -> list of enabled mods that conflict with it
	const conflictMap = $derived(
		(() => {
			const map = new Map<string, string[]>();
			for (const mod of mods) {
				if (!mod.enabled) continue;
				for (const conf of parseConflicts(mod.dependencies)) {
					if (!map.has(conf)) {
						map.set(conf, []);
					}
					const arr = map.get(conf)!;
					if (!arr.includes(mod.name)) arr.push(mod.name);
				}
			}
			return map;
		})()
	);

	// ----------------- Fetching mod details -----------------
	interface ModDetail {
		name: string;
		title?: string;
		summary?: string;
		description?: string;
		thumbnail?: string;
		owner?: string;
		category?: string;
		tags?: string[];
		downloads_count?: number;
		updated_at?: string;
		latest_release?: { version?: string };
	}

	let recommendationDetails = $state<Record<string, ModDetail>>({});

	const PREFETCH_COUNT = 12;
	$effect(() => {
		for (const name of optionalRecommendations.slice(0, PREFETCH_COUNT)) {
			loadModDetail(name);
		}
	});

	function onVisible(node: HTMLElement, modName: string) {
		if (recommendationDetails[modName]) return; // already loaded
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					loadModDetail(modName);
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

	async function loadModDetail(modName: string) {
		if (recommendationDetails[modName]) return;
		try {
			const res = await fetch(`/api/factorio-mods/${modName}`);
			if (!res.ok) return;
			const data = await res.json();
			const latest = data.releases?.[data.releases.length - 1] ?? {};
			recommendationDetails[modName] = {
				name: modName,
				title: data.title,
				summary: data.summary,
				description: data.description,
				thumbnail: data.thumbnail,
				owner: data.owner,
				category: data.category,
				tags: data.tags,
				downloads_count: data.downloads_count,
				updated_at: data.updated_at,
				latest_release: { version: latest.version }
			};
		} catch {
			// ignore failures
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
		<BookIcon class="mr-2 h-4 w-4" />
		Recommendations
	</Sheet.Trigger>

	<Sheet.Content side="right" class="w-[800px] !max-w-[800px] sm:w-[800px]">
		<Sheet.Header>
			<Sheet.Title>Recommended Mods</Sheet.Title>
			<Sheet.Description>Optional dependencies you may consider adding.</Sheet.Description>
		</Sheet.Header>

		<div class="space-y-6 overflow-y-auto p-4">
			{#if optionalRecommendations.length === 0}
				<p>No recommendations available.</p>
			{:else}
				{#each optionalRecommendations as modName (modName)}
					<div
						use:onVisible={modName}
						class="flex gap-4 rounded-lg border p-4 transition-colors {conflictMap.get(modName)
							?.length
							? 'bg-destructive/20 border-destructive'
							: 'hover:bg-muted/50'}"
					>
						<!-- Thumbnail -->
						<div class="flex-shrink-0">
							{#if recommendationDetails[modName]?.thumbnail}
								<img
									src={`https://assets-mod.factorio.com${recommendationDetails[modName].thumbnail}`}
									alt={recommendationDetails[modName].title || modName}
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
							<!-- Title & Author -->
							<div class="mb-1">
								<a
									href={`https://mods.factorio.com/mod/${modName}`}
									class="text-foreground truncate text-left text-lg font-semibold"
									onclick={(e) => {
										if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
											e.preventDefault();
											openModPreview(modName);
										}
									}}
								>
									{recommendationDetails[modName]?.title ?? modName}
								</a>
								{#if recommendationDetails[modName]?.owner}
									<p class="text-muted-foreground flex items-center gap-1 text-sm">
										<span>by</span>
										<span class="text-accent font-medium"
											>{recommendationDetails[modName].owner}</span
										>
									</p>
								{/if}
							</div>

							<!-- Description -->
							{#if recommendationDetails[modName]?.summary}
								<p class="text-muted-foreground mb-3 line-clamp-2 text-sm">
									{recommendationDetails[modName].summary}
								</p>
							{/if}

							<!-- Metadata -->
							<div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-4 text-xs">
								{#if recommendationDetails[modName]?.category}
									<div class="flex items-center gap-1">
										<NutIcon class="h-3 w-3" />
										<span class="capitalize">{recommendationDetails[modName].category}</span>
									</div>
								{/if}
								{#if recommendationDetails[modName]?.updated_at}
									<div class="flex items-center gap-1">
										<ClockIcon class="h-3 w-3" />
										<span>{formatDate(recommendationDetails[modName].updated_at)}</span>
									</div>
								{/if}
								{#if recommendationDetails[modName]?.latest_release?.version}
									<div class="flex items-center gap-1">
										<span class="text-green-500">🏷️</span>
										<span>{recommendationDetails[modName].latest_release.version}</span>
									</div>
								{/if}
								<div class="flex items-center gap-1">
									<DownloadIcon class="h-3 w-3" />
									<span>{formatDownloads(recommendationDetails[modName]?.downloads_count)}</span>
								</div>
							</div>

							<!-- Conflict Badges -->
							{#if (conflictMap.get(modName)?.length ?? 0) > 0}
								<div class="mt-2 flex flex-wrap gap-1">
									<span class="text-muted-foreground text-sm">Conflicts with:</span>
									{#each conflictMap.get(modName)?.slice(0, 5) ?? [] as c (c)}
										<Badge variant="destructive">{c}</Badge>
									{/each}
									{#if (conflictMap.get(modName)?.length ?? 0) > 5}
										<span
											class="bg-destructive text-destructive-foreground rounded-full px-2 py-0.5 text-xs"
										>
											+{(conflictMap.get(modName)?.length ?? 0) - 5} more
										</span>
									{/if}
								</div>
							{/if}

							<!-- Recommender Badges -->
							{#if (optionalDependencyMap.get(modName)?.length ?? 0) > 0}
								<div class="mt-2 flex flex-wrap gap-1">
									<span class="text-muted-foreground text-sm">Recommended by:</span>
									{#each optionalDependencyMap.get(modName)?.slice(0, 5) ?? [] as rec (rec)}
										<Badge variant="outline">{rec}</Badge>
									{/each}
									{#if (optionalDependencyMap.get(modName)?.length ?? 0) > 5}
										<span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
											+{(optionalDependencyMap.get(modName)?.length ?? 0) - 5} more
										</span>
									{/if}
								</div>
							{/if}
						</div>

						<!-- Action Button -->
						<div class="flex flex-shrink-0 items-start">
							<form method="POST" action="?/addMod" use:enhance>
								<input type="hidden" name="modName" value={modName} />
								<Button type="submit" size="sm" variant="success">
									<PlusIcon class="mr-1 h-3 w-3" />
									Add to List
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
