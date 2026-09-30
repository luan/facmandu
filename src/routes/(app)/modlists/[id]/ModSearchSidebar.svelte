<script lang="ts">
	import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Input from '$lib/components/ui/input/input.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { SearchIcon, FilterIcon } from '@lucide/svelte';

	interface Props {
		factorioVersion: string;
	}

	let { factorioVersion }: Props = $props();

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

	const versions = ['any', '2.1', '2.0', '1.1', '1.0', '0.18', '0.17', '0.16', '0.15', '0.14', '0.13'];

	// Sorting options matching Factorio API
	const sortOptions = [
		{ value: 'last_updated_at', label: 'Last Updated' },
		{ value: 'relevancy', label: 'Relevance' },
		{ value: 'most_downloads', label: 'Downloads' },
		{ value: 'trending', label: 'Trending' }
	];

	let q = $state('');
 let category = $state('');
 let version = $state('');
 let selectedTags = $state<string[]>([]);
 let sortAttr = $state('relevancy');
 $effect(() => {
  const params = page.url.searchParams;
  q = params.get('q') || '';
  category = params.get('category') || '';
  version = params.get('version') || factorioVersion;
  selectedTags = params.getAll('tag');
  sortAttr = params.get('sort_attr') || 'relevancy';
 });
</script>

<div class="flex flex-col gap-4">
	<form method="GET" class="flex flex-col gap-4" onsubmit={(event) => { event.preventDefault(); const query = new URLSearchParams(); for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string') query.append(key, value); void goto(`${page.url.pathname}?${query}`, { keepFocus: true, noScroll: true }); }}>
		<!-- Text search -->
		<div class="flex items-center gap-2">
			<Input name="q" aria-label="Search mods" maxlength={200} placeholder="Search mods..." bind:value={q} class="flex-1" />
			<TooltipButton type="submit" variant="outline" size="icon" tooltip="Search">
				<SearchIcon class="h-4 w-4" />
			</TooltipButton>
		</div>

		<details class="border-border rounded-md border p-3">
			<summary class="cursor-pointer text-sm font-medium">Search filters</summary>
			<div class="mt-4 flex flex-col gap-4">
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
						<input type="checkbox" name="tag" value={t} checked={selectedTags.includes(t)} onchange={(event) => { selectedTags = event.currentTarget.checked ? [...selectedTags, t] : selectedTags.filter((tag) => tag !== t); }} />
						{t.replace(/-/g, ' ')}
					</label>
				{/each}
			</div>
		</div>

		<!-- Reset to first page when new filters applied -->
		<input type="hidden" name="page" value="1" />

		<Button type="submit" variant="default"><FilterIcon class="size-4" />Apply Filters</Button>
			</div>
		</details>
	</form>

</div>
