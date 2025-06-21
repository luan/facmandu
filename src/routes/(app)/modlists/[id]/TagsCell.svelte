<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Badge } from '$lib/components/ui/badge';
	import type { Mod } from '$lib/server/db/schema';

	interface Props {
		mod: Mod;
	}

	let { mod }: Props = $props();

	function parseTags(tagsJson?: string | null): string[] {
		if (!tagsJson) return [];
		try {
			return JSON.parse(tagsJson);
		} catch {
			return [];
		}
	}

	let tags = $derived(parseTags(mod.tags));
</script>

{#if tags.length > 0}
	<div class="flex flex-wrap gap-1">
		{#each tags.slice(0, 2) as tag (tag)}
			<Badge variant="outline" class="px-1 py-0 text-[10px]">
				{tag}
			</Badge>
		{/each}
		{#if tags.length > 2}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Badge variant="outline" class="px-1 py-0 text-[10px]">
						+{tags.length - 2}
					</Badge>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<div class="flex max-w-60 flex-wrap gap-1">
						{#each tags as tag (tag)}
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
