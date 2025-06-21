<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Input } from '$lib/components/ui/input';
	import {
		BookIcon,
		RefreshCwIcon,
		PlusIcon,
		ClockIcon,
		DownloadIcon,
		NutIcon
	} from '@lucide/svelte';
	import type { Mod } from '$lib/server/db/schema';
	import {
		type ColumnDef,
		type ColumnFiltersState,
		type SortingState,
		type VisibilityState,
		type SortingFn,
		getCoreRowModel,
		getFilteredRowModel,
		getSortedRowModel
	} from '@tanstack/table-core';
	import {
		createSvelteTable,
		FlexRender,
		renderComponent
	} from '$lib/components/ui/data-table/index.js';
	import { createRawSnippet } from 'svelte';
	import ThumbnailCell from './ThumbnailCell.svelte';
	import ModInfoCell from './ModInfoCell.svelte';
	import TagsCell from './TagsCell.svelte';
	import ActionsCell from './ActionsCell.svelte';
	import StatusCell from './StatusCell.svelte';
	import CategoryCell from './CategoryCell.svelte';
	import VersionCell from './VersionCell.svelte';
	import DownloadsCell from './DownloadsCell.svelte';
	import UpdatedCell from './UpdatedCell.svelte';
	import SortableHeader from './SortableHeader.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		mods: Array<Omit<Mod, 'updatedBy'> & { updatedBy: { id: string; username: string } | null }>;
		modlistName: string;
		conflictingMods: string[];
	}

	let { mods, modlistName, conflictingMods }: Props = $props();
	let confirmDeleteId: string | null = $state(null);
	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);
	let columnVisibility = $state<VisibilityState>({});

	// Derive the table row type from the `mods` prop to keep types in sync
	type RowMod = Props['mods'][number];

	// Holds fetched details for recommended mods
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

	// Helper to parse dependency strings similar to server logic
	function parseDependencies(dependencyString: string | null): string[] {
		if (!dependencyString) return [];

		try {
			const deps = JSON.parse(dependencyString) as string[];
			return (
				deps
					.map((dep) => {
						// Extract the raw name segment before any version specifier
						const [raw] = dep.split(/>=|>|<=|<|=/);
						let name = raw.trim();

						// Skip conflicts entirely
						if (name.startsWith('!')) {
							return null;
						}

						// Ignore optional dependencies (prefixed with '?' or '(?)')
						if (name.startsWith('?') || name.startsWith('(?)')) {
							return null;
						}

						// Incompatibility (~) – treat as regular dependency
						if (name.startsWith('~')) {
							return name.slice(1).trim();
						}

						return name;
					})
					// Filter out null entries (optional dependencies)
					.filter((d): d is string => Boolean(d))
			);
		} catch {
			return [];
		}
	}

	// Reactive set of mods that are dependencies of other enabled mods
	const dependencySet = $derived(
		(() => {
			const deps = new Set<string>();
			const baseMods = new Set(['base', 'space-age', 'quality', 'elevated-rails']);

			for (const mod of mods) {
				if (!mod.enabled) continue;
				for (const dep of parseDependencies(mod.dependencies)) {
					if (!baseMods.has(dep)) {
						deps.add(dep);
					}
				}
			}
			return deps;
		})()
	);

	// Map of dependencies -> list of mods that require them
	const dependencyMap = $derived(
		(() => {
			const map = new Map<string, string[]>();
			const baseMods = new Set(['base', 'space-age', 'quality', 'elevated-rails']);

			for (const mod of mods) {
				if (!mod.enabled) continue;
				for (const dep of parseDependencies(mod.dependencies)) {
					if (baseMods.has(dep)) continue;
					if (!map.has(dep)) {
						map.set(dep, []);
					}
					const arr = map.get(dep)!;
					if (!arr.includes(mod.name)) {
						arr.push(mod.name);
					}
				}
			}
			return map;
		})()
	);

	// Set of mods explicitly marked as essential
	const essentialSet = $derived(new Set(mods.filter((m) => m.essential).map((m) => m.name)));

	// Dependencies that stem specifically from locked (essential) mods
	const lockedDependencySet = $derived(
		(() => {
			const deps = new Set<string>();
			const baseMods = new Set(['base', 'space-age', 'quality', 'elevated-rails']);
			for (const mod of mods) {
				if (!mod.essential) continue;
				for (const dep of parseDependencies(mod.dependencies)) {
					if (!baseMods.has(dep)) {
						deps.add(dep);
					}
				}
			}
			return deps;
		})()
	);

	// State to control hiding of essential mods and their dependencies
	let hideEssential = $state(false);

	// State to control hiding of dependency mods
	let hideDependencies = $state(false);

	// Filtered list based on hide toggle
	const visibleMods = $derived(
		(() => {
			return mods.filter((m) => {
				// Exclude locked (essential) mods and their dependencies when requested
				if (hideEssential && (essentialSet.has(m.name) || lockedDependencySet.has(m.name))) {
					return false;
				}

				// Exclude regular dependency mods when requested (this should apply even when hideEssential is active)
				if (hideDependencies && dependencySet.has(m.name)) {
					return false;
				}

				return true;
			});
		})()
	);

	// Helper to rank a mod's status for sorting purposes
	function statusRank(mod: RowMod): number {
		if (mod.essential) return 3; // Locked
		if (dependencySet.has(mod.name)) return 2; // Dependency
		return mod.enabled ? 1 : 0; // Enabled / Disabled
	}

	// Custom sorting function that considers locked and dependency states
	const statusSortingFn: SortingFn<RowMod> = (rowA, rowB) => {
		const rankDiff = statusRank(rowA.original) - statusRank(rowB.original);
		if (rankDiff !== 0) return rankDiff;

		// Same status rank — if locked (essential) compare who locked it
		if (rowA.original.essential && rowB.original.essential) {
			const userA = (rowA.original.updatedBy as { username?: string } | null)?.username ?? '';
			const userB = (rowB.original.updatedBy as { username?: string } | null)?.username ?? '';
			return userA.localeCompare(userB);
		}

		// Fallback: alphabetical by mod name for stable ordering
		return rowA.original.name.localeCompare(rowB.original.name);
	};

	const columns: ColumnDef<RowMod>[] = [
		{
			id: 'thumbnail',
			header: '',
			cell: ({ row }) => {
				const mod = row.original;
				return renderComponent(ThumbnailCell, { mod: mod as unknown as Mod });
			},
			enableSorting: false,
			size: 60
		},
		{
			accessorKey: 'enabled',
			id: 'status',
			header: ({ header }) => {
				const statusHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Status'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: statusHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const mod = row.original;
				const lockedByUser = row.getValue('updatedBy') as {
					id: string;
					username: string;
				} | null;
				return renderComponent(StatusCell, {
					mod: mod as unknown as Mod,
					isDependency: dependencySet.has(mod.name),
					isEssential: essentialSet.has(mod.name),
					lockedByUser,
					requiredBy: dependencyMap.get(mod.name) ?? []
				});
			},
			sortingFn: statusSortingFn,
			size: 80
		},
		{
			accessorKey: 'name',
			header: ({ header }) => {
				const modHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Mod'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: modHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const mod = row.original;
				return renderComponent(ModInfoCell, { mod: mod as unknown as Mod });
			},
			minSize: 160
		},
		{
			accessorKey: 'category',
			header: ({ header }) => {
				const categoryHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Category'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: categoryHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const category = row.getValue('category') as string | null;
				return renderComponent(CategoryCell, { category });
			},
			size: 120
		},
		{
			accessorKey: 'version',
			header: ({ header }) => {
				const versionHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Version'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: versionHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const version = row.getValue('version') as string | null;
				return renderComponent(VersionCell, { version });
			},
			size: 100
		},
		{
			accessorKey: 'downloadsCount',
			header: ({ header }) => {
				const downloadsHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Downloads'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: downloadsHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const downloads = row.getValue('downloadsCount') as number | null;
				return renderComponent(DownloadsCell, { downloads });
			},
			size: 100
		},
		{
			accessorKey: 'lastUpdated',
			header: ({ header }) => {
				const updatedHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Updated'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: updatedHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const lastUpdated = row.getValue('lastUpdated') as Date | null;
				return renderComponent(UpdatedCell, { lastUpdated });
			},
			size: 100
		},
		{
			accessorKey: 'updatedBy',
			header: ({ header }) => {
				const updatedByHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Enabled By'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: updatedByHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const updatedBy = row.getValue('updatedBy') as {
					id: string;
					username: string;
				} | null;
				return updatedBy?.username || '-';
			},
			size: 100
		},
		{
			accessorKey: 'tags',
			header: 'Tags',
			cell: ({ row }) => {
				const mod = row.original;
				return renderComponent(TagsCell, { mod: mod as unknown as Mod });
			},
			enableSorting: false,
			size: 150
		},
		{
			id: 'actions',
			header: 'Actions',
			cell: ({ row }) => {
				const mod = row.original;
				return renderComponent(ActionsCell, {
					mod: mod as unknown as Mod,
					confirmDeleteId,
					onDeleteClick: handleDeleteClick
				});
			},
			enableSorting: false,
			size: 100
		}
	];

	const table = createSvelteTable({
		get data() {
			return visibleMods;
		},
		columns,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: (updater) => {
			if (typeof updater === 'function') {
				sorting = updater(sorting);
			} else {
				sorting = updater;
			}
		},
		onColumnFiltersChange: (updater) => {
			if (typeof updater === 'function') {
				columnFilters = updater(columnFilters);
			} else {
				columnFilters = updater;
			}
		},
		onColumnVisibilityChange: (updater) => {
			if (typeof updater === 'function') {
				columnVisibility = updater(columnVisibility);
			} else {
				columnVisibility = updater;
			}
		},
		state: {
			get sorting() {
				return sorting;
			},
			get columnFilters() {
				return columnFilters;
			},
			get columnVisibility() {
				return columnVisibility;
			}
		}
	});

	// Helper to parse optional dependency strings
	function parseOptionalDependencies(dependencyString: string | null): string[] {
		if (!dependencyString) return [];

		try {
			const deps = JSON.parse(dependencyString) as string[];
			return (
				deps
					.map((dep) => {
						// Extract the raw name segment before any version specifier
						const [raw] = dep.split(/>=|>|<=|<|=/);
						let name = raw.trim();

						// Only consider optional dependencies (prefixed with '?' or '(?)')
						if (name.startsWith('(?)')) {
							name = name.slice(3).trim();
						} else if (name.startsWith('?')) {
							name = name.slice(1).trim();
						} else {
							return null;
						}

						// Ignore conflicts or empty strings
						if (!name || name.startsWith('!')) return null;

						// Incompatibility (~) – treat as regular dependency name
						if (name.startsWith('~')) {
							return name.slice(1).trim();
						}

						return name;
					})
					// Filter out null entries
					.filter((d): d is string => Boolean(d))
			);
		} catch {
			return [];
		}
	}

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

	const PREFETCH_COUNT = 12;
	// Prefetch a limited number of recommendations to avoid jank when opening
	$effect(() => {
		for (const name of optionalRecommendations.slice(0, PREFETCH_COUNT)) {
			loadModDetail(name);
		}
	});

	// IntersectionObserver action to lazily load mod details when visible
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
			// ignore failures, keep placeholder
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

	// Helper to parse conflicts from dependency string
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
</script>

<Tooltip.Provider>
	<Card.Root>
		<Card.Header>
			<Card.CardAction class="flex flex-row-reverse items-center gap-2">
				<form method="POST" action="?/refreshAllMods" use:enhance>
					<Button type="submit" variant="outline" size="sm">
						<RefreshCwIcon class="mr-2 h-4 w-4" />
						Refresh All
					</Button>
				</form>

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
										class="flex gap-4 rounded-lg border p-4 transition-colors {conflictMap.get(
											modName
										)?.length
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
											<!-- Title and Author -->
											<div class="mb-1">
												<a
													href={`https://mods.factorio.com/mod/${modName}`}
													class="text-foreground truncate text-lg font-semibold"
													target="_blank"
													rel="noopener noreferrer"
													>{recommendationDetails[modName]?.title ?? modName}</a
												>
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

											<!-- Metadata Row -->
											<div
												class="text-muted-foreground mb-2 flex flex-wrap items-center gap-4 text-xs"
											>
												{#if recommendationDetails[modName]?.category}
													<div class="flex items-center gap-1">
														<NutIcon class="h-3 w-3" />
														<span class="capitalize">{recommendationDetails[modName].category}</span
														>
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
													<span
														>{formatDownloads(
															recommendationDetails[modName]?.downloads_count
														)}</span
													>
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
															>+{(conflictMap.get(modName)?.length ?? 0) - 5} more</span
														>
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
														<span
															class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
															>+{(optionalDependencyMap.get(modName)?.length ?? 0) - 5} more</span
														>
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
				<div class="space-y-4">
					<!-- Filters -->
					<div class="flex items-center gap-4">
						<Input
							placeholder="Filter mods..."
							value={table.getColumn('name')?.getFilterValue() as string}
							onchange={(e) => table.getColumn('name')?.setFilterValue(e.currentTarget.value)}
							oninput={(e) => table.getColumn('name')?.setFilterValue(e.currentTarget.value)}
							class="max-w-sm"
						/>

						<!-- Hide dependencies toggle -->
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={hideDependencies} />
							Hide dependencies
						</label>

						<!-- Hide essential mods toggle -->
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={hideEssential} />
							Hide locked mods
						</label>
					</div>

					<!-- Data Table -->
					<div class="rounded-md border">
						<Table.Root>
							<Table.Header>
								{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
									<Table.Row>
										{#each headerGroup.headers as header (header.id)}
											<Table.Head class="p-2" style="width: {header.getSize()}px;">
												{#if !header.isPlaceholder}
													<FlexRender
														content={header.column.columnDef.header}
														context={header.getContext()}
													/>
												{/if}
											</Table.Head>
										{/each}
									</Table.Row>
								{/each}
							</Table.Header>
							<Table.Body>
								{#each table.getRowModel().rows as row (row.id)}
									<Table.Row
										class="{row.original.enabled ? '' : 'opacity-50'}{conflictingMods.includes(
											row.original.name
										)
											? ' bg-destructive/20 border-destructive'
											: ''}"
										data-mod-id={row.original.id}
									>
										{#each row.getVisibleCells() as cell (cell.id)}
											<Table.Cell class="p-2">
												<FlexRender
													content={cell.column.columnDef.cell}
													context={cell.getContext()}
												/>
											</Table.Cell>
										{/each}
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</Tooltip.Provider>
