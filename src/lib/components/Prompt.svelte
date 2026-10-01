<script lang="ts">
 import { tick, type Snippet } from 'svelte';
 import { SendIcon, SquareIcon, LoaderCircleIcon } from '@lucide/svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import { tokenClass, type highlightCommand } from '$lib/console';
 let { value = $bindable(''), element = $bindable(), label, placeholder, busy = false, disabledReason = '', maxLength, controls, tokens, completionId, activeOption, onkeydown, oninput, send, stop }: {
  value?: string; element?: HTMLTextAreaElement; label: string; placeholder: string;
  busy?: boolean; disabledReason?: string; maxLength: number; controls?: Snippet;
  tokens?: ReturnType<typeof highlightCommand>; completionId?: string; activeOption?: string;
  onkeydown?: (event: KeyboardEvent) => void; oninput?: () => void; send: () => void; stop?: () => void;
 } = $props();
 let scrollTop = $state(0);
 $effect(() => { void value; void tick().then(() => { if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(176, element.scrollHeight)}px`; } }); });
 function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  onkeydown?.(event);
  if (!event.defaultPrevented && event.key === 'Enter' && !event.shiftKey) {
   event.preventDefault(); if (!busy && !disabledReason && value.trim()) send();
  }
 }
</script>
<div class="prompt" class:font-mono={!!tokens}>
 <div class="prompt-editor">
  {#if tokens}<div aria-hidden="true" class="prompt-highlight"><pre style:transform={`translateY(-${scrollTop}px)`}>{#each tokens as token, index (index)}<span class={tokenClass(token.kind)}>{token.text}</span>{/each}</pre></div>{/if}
  <textarea bind:this={element} bind:value aria-label={label} {placeholder} maxlength={maxLength} rows="1" spellcheck={!tokens} autocomplete="off" aria-autocomplete={completionId ? 'list' : undefined} aria-controls={completionId} aria-activedescendant={activeOption} onkeydown={keydown} oninput={() => oninput?.()} onscroll={(event) => scrollTop = event.currentTarget.scrollTop} class:highlighted={!!tokens}></textarea>
 </div>
 <div class="prompt-actions">
  {#if controls}<div class="flex min-w-0 flex-wrap items-center gap-2 font-sans">{@render controls()}</div>{/if}
  <div class="ml-auto font-sans">
   {#if busy && stop}<TooltipButton tooltip="Stop" variant="secondary" size="sm" onclick={stop}><SquareIcon class="size-4" />Stop</TooltipButton>
   {:else}<TooltipButton type="submit" tooltip={disabledReason || 'Send'} size="sm" disabled={busy || !!disabledReason || !value.trim()}>{#if busy}<LoaderCircleIcon class="size-4 animate-spin" />{:else}<SendIcon class="size-4" />{/if}Send</TooltipButton>{/if}
  </div>
 </div>
</div>
<style>
 .prompt { border: 1px solid var(--border); background: var(--background); }
 .prompt:focus-within { border-color: color-mix(in srgb, var(--primary) 60%, transparent); }
 .prompt-editor { position: relative; }
 .prompt-editor textarea, .prompt-highlight pre { margin: 0; width: 100%; padding: 12px; font: inherit; font-size: 14px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
 .prompt-editor textarea { display: block; min-height: 46px; max-height: 176px; resize: none; border: 0; background: transparent; box-shadow: none; outline: none; }
 .prompt-editor textarea.highlighted { color: transparent; caret-color: var(--foreground); }
 .prompt-highlight { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
 .prompt-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; padding: 0 12px 10px; }
</style>
