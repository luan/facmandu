<script lang="ts">
	import Button, { type ButtonProps } from './button.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	let { tooltip, ref = $bindable(null), children, ...props }: ButtonProps & { tooltip: string } = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props: triggerProps })}
			{#if props.disabled}
   <!-- biome-ignore lint/a11y/useSemanticElements: A focusable wrapper exposes the disabled button reason without nesting buttons. -->
   <span {...triggerProps} tabindex="0" role="button" aria-disabled="true" aria-label={props['aria-label'] ?? tooltip} class="inline-flex"><Button {...props} bind:ref tabindex={-1} class={`${props.class ?? ''} pointer-events-none`}>{@render children?.()}</Button></span>
   {:else}
   <Button {...triggerProps} {...props} bind:ref aria-label={props['aria-label'] ?? tooltip}>
				{@render children?.()}
			</Button>
   {/if}
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>{tooltip}</Tooltip.Content>
</Tooltip.Root>
