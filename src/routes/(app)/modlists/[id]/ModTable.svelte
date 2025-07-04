<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Input } from '$lib/components/ui/input';
	import { RefreshCwIcon } from '@lucide/svelte';
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
	import { createSvelteTable, FlexRender, renderComponent } from '$lib/components/ui/data-table';
	import { createRawSnippet } from 'svelte';
	import ThumbnailCell from './ThumbnailCell.svelte';
	import ModInfoCell from './ModInfoCell.svelte';
	import TagsCell from './TagsCell.svelte';
	import ActionsCell from './ActionsCell.svelte';
	import StatusCell from './StatusCell.svelte';
	import CategoryCell from './CategoryCell.svelte';
	import DownloadsCell from './DownloadsCell.svelte';
	import UpdatedCell from './UpdatedCell.svelte';
	import SortableHeader from './SortableHeader.svelte';
	import ModPreviewSheet from './ModPreviewSheet.svelte';
	import RecommendationSheet from './RecommendationSheet.svelte';
	import IceboxSheet from './IceboxSheet.svelte';

	interface Props {
		mods: Array<Omit<Mod, 'updatedBy'> & { updatedBy: { id: string; username: string } | null }>;
		modlistName: string;
		conflictingMods: string[];
		iceboxMods: Mod[];
	}

	let { mods, modlistName, conflictingMods, iceboxMods }: Props = $props();
	let confirmDeleteId: string | null = $state(null);
	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);
	let columnVisibility = $state<VisibilityState>({});
	let previewOpen = $state(false);
	let previewModName = $state<string | null>(null);

	// Derive the table row type from the `mods` prop to keep types in sync
	type RowMod = Props['mods'][number];

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
			size: 140
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
				return renderComponent(ModInfoCell, {
					mod: mod as unknown as Mod,
					version: mod.version,
					onOpenPreview: openModPreview
				});
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
			enableHiding: true,
			header: ({ header }) => {
				const updatedByHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Enabled By'
				}));
				return renderComponent(SortableHeader, {
					header,
					hide: true,
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

	function openModPreview(modName: string) {
		previewModName = modName;
		previewOpen = true;
	}

	$effect(() => {
		if (!previewOpen) {
			previewModName = null;
		}
	});
</script>

<Tooltip.Provider>
	<ModPreviewSheet bind:open={previewOpen} modName={previewModName} />
	<Card.Root>
		<Card.Header>
			<Card.CardAction class="flex flex-row-reverse items-center gap-2">
				<form method="POST" action="?/refreshAllMods" use:enhance>
					<Button type="submit" variant="outline" size="sm">
						<RefreshCwIcon class="mr-2 h-4 w-4" />
						Refresh All
					</Button>
				</form>
				<RecommendationSheet {mods} />
				<IceboxSheet {iceboxMods} />
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
