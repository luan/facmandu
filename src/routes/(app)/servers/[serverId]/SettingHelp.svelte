<script lang="ts">
	import { InfoIcon } from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import FactorioRichText from '$lib/components/FactorioRichText.svelte';
	import { parseFactorioRichText } from '$lib/factorio-rich-text';

	let { label, description, serverId }: { label: string; description: string; serverId: string } =
		$props();
	let open = $state(false);
	let wasOpenOnPointerDown = false;
	const plainLabel = $derived(
		parseFactorioRichText(label).map((part) => part.kind === 'text' ? part.text : part.caption).join('').trim() || 'setting'
	);
</script>

<Tooltip.Provider delayDuration={150}>
	<Tooltip.Root bind:open disableCloseOnTriggerClick>
		<Tooltip.Trigger
			type="button"
			aria-label={`About ${plainLabel}`}
			aria-expanded={open}
			class="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2"
			onpointerdown={() => { wasOpenOnPointerDown = open; }}
			onclick={(event) => { open = event.detail === 0 ? !open : !wasOpenOnPointerDown; }}
		>
			<InfoIcon class="size-4" aria-hidden="true" />
		</Tooltip.Trigger>
		<Tooltip.Content
			side="top"
			arrowClasses="bg-popover"
			class="border border-input/50 bg-popover text-popover-foreground p-3 shadow-xl max-h-72 w-[min(28rem,calc(100vw-2rem))] max-w-none overflow-x-hidden overflow-y-auto break-words text-left text-sm leading-relaxed"
		>
			<div class="mb-1.5 font-semibold"><FactorioRichText text={label} {serverId} /></div>
			<FactorioRichText text={description} {serverId} inline={false} />
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
