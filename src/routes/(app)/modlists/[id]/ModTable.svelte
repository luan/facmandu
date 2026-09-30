<script lang="ts">
	import { modDependencyGraph } from '$lib/mod-dependency-tree';
	import ModDependencyTree from './ModDependencyTree.svelte';
	import { isBundledMod, parseDependencies, supportsFactorio } from '$lib/dependencies';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Table from '$lib/components/ui/table';
	import { Input } from '$lib/components/ui/input';
	import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';
	import type { ModSummary } from '$lib/server/db/schema';
	import ThumbnailCell from './ThumbnailCell.svelte';
	import ModInfoCell from './ModInfoCell.svelte';
	import ActionsCell from './ActionsCell.svelte';
	import StatusCell from './StatusCell.svelte';
	import ModPreviewSheet from './ModPreviewSheet.svelte';

	interface Props {
		mods: Array<Omit<ModSummary, 'updatedBy'> & { updatedBy: { id: string; username: string } | null }>;
		factorioVersion: string;
		conflictingMods: string[];
		readOnly?: boolean;
	}

	let { mods, factorioVersion, conflictingMods, readOnly = false }: Props = $props();
	let confirmDeleteId: string | null = $state(null);
	let sort = $state<'name' | 'status'>('name');
	let descending = $state(false);
	let query = $state('');
	let view = $state<'table' | 'tree'>('table');
	const graph = $derived(modDependencyGraph(mods));
	let page = $state(0);
	const pageSize = 20;
	let previewOpen = $state(false);
	let previewModName = $state<string | null>(null);
	const previewMod = $derived(mods.find((mod) => mod.name === previewModName));

	type RowMod = Props['mods'][number];
	let hideEssential = $state(false);
	let hideDependencies = $state(false);
 let issuesOnly = $state(false);
 const incompatible = (mod: RowMod) => !!mod.enabled && !isBundledMod(mod.name) && !!mod.factorioVersion && !supportsFactorio(mod.factorioVersion, factorioVersion);
	const filtered = $derived.by(() => {
		const needle = query.trim().toLocaleLowerCase();
		return mods.filter((mod) =>
 (!issuesOnly || incompatible(mod) || !!mod.fetchError || conflicts.has(mod.name) || (mod.enabled && (mod.dependencies === null || !mod.version))) &&
			(!hideEssential || (!mod.essential && !lockedDependencySet.has(mod.name))) &&
			(view === 'tree' || !hideDependencies || !dependencyMap.has(mod.name)) &&
			(!needle || `${mod.name} ${mod.title ?? ''}`.toLocaleLowerCase().includes(needle))
		).sort((a, b) => {
			let order = sort === 'status' ? statusRank(a) - statusRank(b) : 0;
			if (!order && sort === 'status' && a.essential && b.essential) {
				order = (a.updatedBy?.username ?? '').localeCompare(b.updatedBy?.username ?? '');
			}
			order ||= (a.title || a.name).localeCompare(b.title || b.name) || a.name.localeCompare(b.name);
			return descending ? -order : order;
		});
	});
	const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
	const currentPage = $derived(Math.min(page, pageCount - 1));
	const rows = $derived(filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize));
	const conflicts = $derived(new Set(conflictingMods));
	function statusRank(mod: RowMod) {
		return mod.essential ? 3 : dependencyMap.has(mod.name) ? 2 : mod.enabled ? 1 : 0;
	}
	function toggleSort(column: typeof sort) {
		descending = sort === column ? !descending : false;
		sort = column;
		page = 0;
	}

	const requiredDependencies = (encoded: string | null) =>
		parseDependencies(encoded).filter((dep) => dep.type === 'required').map((dep) => dep.name);

	const dependencyMap = $derived(graph.requiredBy);

	// Dependencies that stem specifically from locked (essential) mods
	const lockedDependencySet = $derived(
		(() => {
			const deps = new Set<string>();
			for (const mod of mods) {
				if (!mod.essential) continue;
				for (const dep of requiredDependencies(mod.dependencies)) {
					if (!isBundledMod(dep)) {
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


	<ModPreviewSheet bind:open={previewOpen} modName={previewModName} modId={previewMod?.id} selectedVersion={previewMod?.version} {factorioVersion} {readOnly} />
	<div>
		<div class="p-4">
			{#if mods.length === 0}
				<div class="py-8 text-center">
					<p>No mods in this list yet.</p>
					<p class="text-muted-foreground text-sm">Use Add mods in the header to find your first mod.</p>
				</div>
			{:else}
				<div class="space-y-4">
					<!-- Filters -->
					<div class="flex flex-wrap items-center gap-4">
						<Input aria-label="Filter mods" placeholder="Filter mods…" bind:value={query} oninput={() => { page = 0; }} class="max-w-sm" />

						<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={issuesOnly} onchange={() => { page = 0; }} />Show issues only</label>
{#if view === 'table'}
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={hideDependencies} onchange={() => { page = 0; }} />
							Hide dependencies
						</label>

						{/if}
						<!-- Hide essential mods toggle -->
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={hideEssential} onchange={() => { page = 0; }} />
							Hide locked mods
						</label>
<div class="ml-auto flex shrink-0">
						<Button variant={view === 'table' ? 'default' : 'outline'} size="sm" aria-pressed={view === 'table'} onclick={() => { view = 'table'; }}>Table</Button>
						<Button variant={view === 'tree' ? 'default' : 'outline'} size="sm" aria-pressed={view === 'tree'} onclick={() => { view = 'tree'; }}>Dependency tree</Button>
					</div>
					</div>

					{#if view === 'tree'}
						<ModDependencyTree {mods} matches={new Set(filtered.map((mod) => mod.name))} filtering={!!query.trim() || issuesOnly || hideEssential} onOpenPreview={openModPreview} />
					{:else}
					<div class="rounded-md border">
						<Table.Root>
							<Table.Header><Table.Row>
								<Table.Head class="w-12"><span class="sr-only">Thumbnail</span></Table.Head>
								{#each [{ key: 'status', label: 'Status' }, { key: 'name', label: 'Mod' }] as column (column.key)}
									<Table.Head class={column.key === 'status' ? 'w-20' : ''} aria-sort={sort === column.key ? descending ? 'descending' : 'ascending' : 'none'}>
										<button type="button" class="flex items-center gap-1 py-2 hover:text-foreground" onclick={() => toggleSort(column.key === 'status' ? 'status' : 'name')}>
											{column.label}{#if sort !== column.key}<ChevronsUpDownIcon class="h-3 w-3" />{:else if descending}<ArrowDownIcon class="h-3 w-3" />{:else}<ArrowUpIcon class="h-3 w-3" />{/if}
										</button>
									</Table.Head>
								{/each}
								{#if !readOnly}<Table.Head class="w-28">Actions</Table.Head>{/if}
							</Table.Row></Table.Header>
							<Table.Body>
								{#each rows as mod (mod.id)}
									<Table.Row class={`${mod.enabled ? '' : 'opacity-50'} ${conflicts.has(mod.name) ? 'bg-destructive/20 border-destructive' : ''}`} data-mod-id={mod.id}>
										<Table.Cell class="p-2"><ThumbnailCell {mod} /></Table.Cell>
										<Table.Cell class="p-2"><StatusCell {mod} isDependency={dependencyMap.has(mod.name)} isEssential={mod.essential ?? false} {readOnly} lockedByUser={mod.updatedBy} requiredBy={(dependencyMap.get(mod.name) ?? []).map((parent) => parent.title || parent.name)} /></Table.Cell>
										<Table.Cell class="p-2"><ModInfoCell {mod} requiredBy={graph.dependents.get(mod.name) ?? []} version={mod.version} onOpenPreview={openModPreview} />{#if incompatible(mod)}<p class="mt-1 text-xs text-amber-500">Requires Factorio {mod.factorioVersion} · list targets {factorioVersion}</p>{/if}</Table.Cell>
										{#if !readOnly}<Table.Cell class="p-2"><ActionsCell {mod} {confirmDeleteId} onDeleteClick={handleDeleteClick} /></Table.Cell>{/if}
									</Table.Row>
								{:else}
									<Table.Row><Table.Cell colspan={readOnly ? 3 : 4} class="py-8 text-center text-muted-foreground">No mods match these filters.</Table.Cell></Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
					<div class="flex items-center justify-between gap-4 text-sm" aria-live="polite">
						<span class="text-muted-foreground">{filtered.length} mod{filtered.length === 1 ? '' : 's'}{pageCount > 1 ? ` · Page ${currentPage + 1} of ${pageCount}` : ''}</span>
						{#if pageCount > 1}<div class="flex gap-2">
							<Button variant="outline" size="sm" disabled={currentPage === 0} onclick={() => { page = currentPage - 1; }}><ChevronLeftIcon class="size-4" />Previous</Button>
							<Button variant="outline" size="sm" disabled={currentPage + 1 >= pageCount} onclick={() => { page = currentPage + 1; }}>Next<ChevronRightIcon class="size-4" /></Button>
						</div>{/if}
					</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
