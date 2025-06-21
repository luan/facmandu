<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Input } from '$lib/components/ui/input';
	import { RefreshCwIcon } from '@lucide/svelte';
	import type { Mod } from '$lib/server/db/schema';
	import {
		type ColumnDef,
		type ColumnFiltersState,
		type SortingState,
		type VisibilityState,
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

	interface Props {
		mods: Mod[];
		modlistName: string;
		conflictingMods: string[];
	}

	let { mods, modlistName, conflictingMods }: Props = $props();
	let confirmDeleteId: string | null = $state(null);
	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);
	let columnVisibility = $state<VisibilityState>({});

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
			return deps.map((dep) => {
				const [name] = dep.split(/>=|>|<=|</);
				if (name.startsWith('!')) {
					return name.slice(1).trim(); // conflict – still a dependency for visibility purposes
				} else if (name.startsWith('?') || name.startsWith('(?)')) {
					return name.slice(1).trim(); // optional
				} else if (name.startsWith('~')) {
					return name.slice(1).trim();
				}
				return name.trim();
			});
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

	// State to control hiding of dependency mods
	let hideDependencies = $state(false);

	// Filtered list based on hide toggle
	const visibleMods = $derived(
		hideDependencies ? mods.filter((m) => !dependencySet.has(m.name)) : mods
	);

	const columns: ColumnDef<Mod>[] = [
		{
			id: 'thumbnail',
			header: '',
			cell: ({ row }) => {
				const mod = row.original;
				return renderComponent(ThumbnailCell, { mod });
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
				return renderComponent(StatusCell, {
					mod,
					isDependency: dependencySet.has(mod.name)
				});
			},
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
				return renderComponent(ModInfoCell, { mod });
			},
			minSize: 200
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
			accessorKey: 'factorioVersion',
			header: ({ header }) => {
				const factorioHeaderSnippet = createRawSnippet(() => ({
					render: () => 'Factorio'
				}));
				return renderComponent(SortableHeader, {
					header,
					children: factorioHeaderSnippet
				});
			},
			cell: ({ row }) => {
				const version = row.getValue('factorioVersion') as string | null;
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
			accessorKey: 'updatedByUser',
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
				const updatedByUser = row.getValue('updatedByUser') as {
					id: string;
					username: string;
				} | null;
				return updatedByUser?.username || '-';
			},
			size: 100
		},
		{
			accessorKey: 'tags',
			header: 'Tags',
			cell: ({ row }) => {
				const mod = row.original;
				return renderComponent(TagsCell, { mod });
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
					mod,
					confirmDeleteId,
					onDeleteClick: handleDeleteClick
				});
			},
			enableSorting: false,
			size: 120
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
