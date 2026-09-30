<script lang="ts">
 import { RotateCcwIcon } from '@lucide/svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 let { label, context, value, defaultValue, allowZero, onChange }: { label: string; context: string; value?: number; defaultValue?: number; allowZero: boolean; onChange: (value: number | undefined) => void } = $props();
 const choices = [0, 0.17, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 10];
 const available = $derived(allowZero ? choices : choices.slice(1));
 const effective = $derived(value ?? defaultValue ?? 1);
 const percent = $derived(Number((effective * 100).toPrecision(12)));
 const position = $derived(available.reduce((best, choice, index) => Math.abs(choice - effective) < Math.abs(available[best]! - effective) ? index : best, 0));
</script>
{#snippet bar(filled: boolean)}
 <svg class="bar-cap" viewBox={filled ? '73 80 8 8' : '56 72 8 8'} preserveAspectRatio="none" aria-hidden="true"><image href="/ui/factorio-gui.png" width="597" height="1220" /></svg>
 <svg class="bar-center" viewBox={filled ? '81 80 8 8' : '64 72 1 8'} preserveAspectRatio="none" aria-hidden="true"><image href="/ui/factorio-gui.png" width="597" height="1220" /></svg>
 <svg class="bar-cap" viewBox={filled ? '89 80 8 8' : '65 72 8 8'} preserveAspectRatio="none" aria-hidden="true"><image href="/ui/factorio-gui.png" width="597" height="1220" /></svg>
{/snippet}
<div class="min-w-0 text-xs">
 <div class="flex h-6 items-center justify-between gap-1">
  <span class="capitalize text-muted-foreground">{label}</span>
  {#if value !== undefined}<TooltipButton type="button" variant="ghost" size="icon" tooltip="Use preset" aria-label={`Use preset ${context} ${label}`} class="size-6" onclick={() => onChange(undefined)}><RotateCcwIcon class="size-3.5" /></TooltipButton>{/if}
 </div>
 <div class="flex min-w-0 items-center gap-2">
  <span class="slider min-w-0 flex-1">
   <span class="track" aria-hidden="true">{@render bar(false)}<span class="fill" style:width={`${position / (available.length - 1) * 100}%`}>{@render bar(true)}</span></span>
   <span class="notches" aria-hidden="true">{#each available as choice (choice)}<span></span>{/each}</span>
   <input type="range" min="0" max={available.length - 1} step="1" value={position} aria-label={`${context} ${label}`} aria-valuetext={`${value === undefined ? 'Preset ' : ''}${percent}%`} oninput={(event) => onChange(available[Number(event.currentTarget.value)])} />
  </span>
  <span class="relative w-16 shrink-0">
   <input type="number" min={allowZero ? 0 : 1} max="1000" step="any" value={percent} aria-label={`${context} ${label} percent`} oninput={(event) => { if (event.currentTarget.value !== '') onChange(Number(event.currentTarget.value) / 100); }} onblur={(event) => { if (event.currentTarget.value === '') event.currentTarget.value = String(percent); }} class="percentage h-8 w-full border border-border bg-background pl-1 pr-4 text-right tabular-nums" />
   <span class="pointer-events-none absolute inset-y-0 right-1 flex items-center text-muted-foreground" aria-hidden="true">%</span>
  </span>
 </div>
</div>

<style>
 .percentage { appearance: textfield; }
 .percentage::-webkit-inner-spin-button, .percentage::-webkit-outer-spin-button { appearance: none; margin: 0; }

 /* Native GUI textures at 75% atlas scale, with a larger web pointer target. */
 .slider {
  position: relative;
  display: block;
  height: 44px;
 }
 .track {
  position: absolute;
  display: flex;
  inset: 19px 9px auto;
  height: 6px;
  filter: drop-shadow(0 2px 1px #0008);
 }
 .bar-cap { width: 6px; height: 6px; flex: none; }
 .bar-center { min-width: 0; height: 6px; flex: 1; }
 .fill {
  position: absolute;
  display: flex;
  inset: 0 auto 0 0;
  overflow: hidden;
 }
 .notches {
  position: absolute;
  inset: 16px 7.5px auto;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
 }
 .notches span {
  width: 3px;
  height: 12px;
  background: url('/ui/factorio-gui.png') -103.5px -150px / 447.75px 915px;
  filter: drop-shadow(0 1px 1px #0009);
 }
 input[type="range"] {
  position: relative;
  display: block;
  appearance: none;
  width: 100%;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
 }
 input[type="range"]:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
 }
 input[type="range"]::-webkit-slider-runnable-track { height: 6px; background: transparent; }
 input[type="range"]::-moz-range-track { height: 6px; background: transparent; }
 /* Use the same atlas scale for the handle, track, and notches. */
 input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 26.25px;
  margin-top: -10.125px;
  border: 0;
  border-radius: 0;
  background: url('/ui/factorio-gui.png') 0 -141.75px / 447.75px 915px;
  filter: drop-shadow(0 1px 1px #0009);
 }
 input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 26.25px;
  border: 0;
  border-radius: 0;
  background: url('/ui/factorio-gui.png') 0 -141.75px / 447.75px 915px;
  filter: drop-shadow(0 1px 1px #0009);
 }
 input[type="range"]:hover::-webkit-slider-thumb, input[type="range"]:focus-visible::-webkit-slider-thumb { background-position-x: -36px; filter: drop-shadow(0 0 3px #ffc45180) drop-shadow(0 2px 1px #0009); }
 input[type="range"]:hover::-moz-range-thumb, input[type="range"]:focus-visible::-moz-range-thumb { background-position-x: -36px; filter: drop-shadow(0 0 3px #ffc45180) drop-shadow(0 2px 1px #0009); }
 input[type="range"]:active::-webkit-slider-thumb { background-position-x: -54px; filter: drop-shadow(0 1px 1px #0009); }
 input[type="range"]:active::-moz-range-thumb { background-position-x: -54px; filter: drop-shadow(0 1px 1px #0009); }
 @media (forced-colors: active) {
  .track, .notches span { background: CanvasText; }
  .bar-cap, .bar-center { visibility: hidden; }
  .fill { background: Highlight; }
  input[type="range"]::-webkit-slider-thumb { background: ButtonFace; border: 1px solid ButtonText; }
  input[type="range"]::-moz-range-thumb { background: ButtonFace; border: 1px solid ButtonText; }
 }
</style>
