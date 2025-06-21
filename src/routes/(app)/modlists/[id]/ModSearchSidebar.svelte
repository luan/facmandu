<script lang="ts">
	import { browser } from '$app/environment';
	import Input from '$lib/components/ui/input/input.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { SearchIcon } from '@lucide/svelte';

	interface Props {
		searchError: string | null;
		searchQuery?: string;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let { searchError, searchQuery: _searchQuery }: Props = $props();

	// Available filter options
	const categories = [
		{ value: '', label: 'Any Category' },
		{ value: 'content', label: 'Content' },
		{ value: 'overhaul', label: 'Overhaul' },
		{ value: 'tweaks', label: 'Tweaks' },
		{ value: 'utilities', label: 'Utilities' },
		{ value: 'scenarios', label: 'Scenarios' },
		{ value: 'mod-packs', label: 'Mod Packs' },
		{ value: 'localizations', label: 'Localizations' },
		{ value: 'internal', label: 'Internal' }
	];

	const tags = [
		'planets',
		'transportation',
		'logistics',
		'trains',
		'combat',
		'armor',
		'character',
		'enemies',
		'environment',
		'mining',
		'fluids',
		'logistic-network',
		'circuit-network',
		'manufacturing',
		'power',
		'storage',
		'blueprints',
		'cheats'
	];

	const versions = ['any', '2.0', '1.1', '1.0', '0.18', '0.17', '0.16', '0.15', '0.14', '0.13'];

	// Sorting options matching Factorio API
	const sortOptions = [
		{ value: 'last_updated_at', label: 'Last Updated' },
		{ value: 'relevancy', label: 'Relevance' },
		{ value: 'most_downloads', label: 'Downloads' },
		{ value: 'trending', label: 'Trending' }
	];

	const initialParams = browser ? new URLSearchParams(location.search) : new URLSearchParams();
	let q = $state(initialParams.get('q') || '');
	let category = $state(initialParams.get('category') || '');
	let version = $state(initialParams.get('version') || 'any');
	let selectedTags = $state(new Set<string>(initialParams.getAll('tag')));
	let sortAttr = $state(initialParams.get('sort_attr') || 'last_updated_at');

	// No reactive subscription; values remain until navigation refresh.
</script>

<div class="flex flex-col gap-4">
	<form method="GET" class="flex flex-col gap-4">
		<!-- Text search -->
		<div class="flex items-center gap-2">
			<Input name="q" placeholder="Search mods..." bind:value={q} class="flex-1" />
			<Button type="submit" variant="outline" size="icon">
				<SearchIcon class="h-4 w-4" />
			</Button>
		</div>

		<!-- Category filter -->
		<div>
			<label for="category-select" class="mb-1 block text-sm font-medium">Category</label>
			<select
				id="category-select"
				name="category"
				bind:value={category}
				class="w-full rounded border bg-transparent px-2 py-1"
			>
				{#each categories as c (c.value)}
					<option value={c.value}>{c.label}</option>
				{/each}
			</select>
		</div>

		<!-- Factorio version filter -->
		<div>
			<label for="version-select" class="mb-1 block text-sm font-medium">Factorio Version</label>
			<select
				id="version-select"
				name="version"
				bind:value={version}
				class="w-full rounded border bg-transparent px-2 py-1"
			>
				{#each versions as v (v)}
					<option value={v}>{v === 'any' ? 'Any' : v}</option>
				{/each}
			</select>
		</div>

		<!-- Sort attribute -->
		<div>
			<label for="sort-select" class="mb-1 block text-sm font-medium">Sort By</label>
			<select
				id="sort-select"
				name="sort_attr"
				bind:value={sortAttr}
				class="w-full rounded border bg-transparent px-2 py-1"
			>
				{#each sortOptions as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<!-- Tags filter -->
		<div>
			<span class="mb-1 block text-sm font-medium">Tags</span>
			<div class="flex max-h-48 flex-wrap gap-2 overflow-auto rounded border p-2">
				{#each tags as t (t)}
					<label class="flex items-center gap-1 text-xs capitalize">
						<input type="checkbox" name="tag" value={t} checked={selectedTags.has(t)} />
						{t.replace(/-/g, ' ')}
					</label>
				{/each}
			</div>
		</div>

		<Button type="submit" variant="default">Apply Filters</Button>
	</form>

	{#if searchError}
		<p class="text-destructive text-sm">{searchError}</p>
	{/if}
</div>
