<script lang="ts">
 import { tick } from 'svelte';
 import { PlusIcon, XIcon } from '@lucide/svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import type { SettingDef } from '$lib/server/mod-settings-lua';
 import SettingInput from './SettingInput.svelte';
 type Color = { r: number; g: number; b: number; a?: number };
 let {
  id,
  value = $bindable(),
  onchange,
  min,
  max,
  allowed,
  allowedLabels,
  label: accessibleLabel,
  type,
  disabled = false
 }: {
  id: string;
  value: unknown;
  onchange?: (value: unknown) => void;
  min?: number;
  max?: number;
  allowed?: string[] | number[];
  allowedLabels?: Record<string, string>;
  label?: string;
  type?: SettingDef['type'];
  disabled?: boolean;
 } = $props();
 function update(next: unknown) { value = next; onchange?.(next); }
 function isColor(candidate: unknown): candidate is Color {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const channels = candidate as Record<string, unknown>;
  return ['r', 'g', 'b'].every((key) => typeof channels[key] === 'number') &&
   (channels.a === undefined || typeof channels.a === 'number');
 }
 function setColorChannel(color: Color, key: keyof Color, next: number) {
  if (Number.isFinite(next)) update({ ...color, [key]: next });
 }
 const inputClass = 'border-input bg-background w-full min-w-0 border px-2 py-1.5 text-sm';
 const label = $derived(accessibleLabel || id.replace(/^setting-/u, '').replaceAll('_', ' '));
 async function addItem() { if (!Array.isArray(value)) return; const index = value.length; update([...value, '']); await tick(); document.getElementById(index === 0 ? id : `${id}-${index}`)?.focus(); }
 function replaceItem(index: number, next: string) { if (Array.isArray(value)) update(value.map((item, i) => i === index ? next : item)); }
</script>
{#if typeof value === 'boolean'}
 <input {id} type="checkbox" checked={value} {disabled} onchange={(event) => update(event.currentTarget.checked)} class="size-4 accent-primary" />
{:else if Array.isArray(value) && value.every((item) => typeof item === 'string')}
 <div class="flex flex-wrap items-center gap-2">
 {#each value as item, index (index)}
  <div class="inline-flex min-w-0 items-center gap-1">
   <input id={index === 0 ? id : `${id}-${index}`} aria-label={`${label} ${index + 1}`} class={`${inputClass} max-w-52`} value={item} required {disabled} oninput={(event) => replaceItem(index, event.currentTarget.value)} />
   <TooltipButton tooltip={`Remove ${item || label}`} variant="ghost" size="icon" {disabled} onclick={() => { if (Array.isArray(value)) update(value.filter((_, i) => i !== index)); }}><XIcon class="size-4" /></TooltipButton>
  </div>
 {/each}
 <TooltipButton tooltip={`Add ${label}`} variant="outline" size="icon" {disabled} onclick={addItem}><PlusIcon class="size-4" /></TooltipButton>
 </div>
{:else if isColor(value)}
 <div class="flex flex-wrap gap-2">
  {#each (['r', 'g', 'b', 'a'] as const) as channel (channel)}
   <label class="flex items-center gap-1 text-xs uppercase">{channel}
    <input id={`${id}-${channel}`} aria-label={`${label} ${channel}`} class={`${inputClass} w-20`} type="number" step="any" min="0" required {disabled} value={value[channel] ?? 1} oninput={(event) => setColorChannel(value as Color, channel, event.currentTarget.valueAsNumber)} />
   </label>
  {/each}
 </div>
{:else if value !== null && typeof value === 'object' && !Array.isArray(value)}
 <div class="flex flex-wrap gap-x-5 gap-y-2">
 {#each Object.entries(value) as [key, entry] (key)}
  <div class="flex items-center gap-2 text-sm"><label for={`${id}-${key}`}>{key.replaceAll('_', ' ')}</label><SettingInput id={`${id}-${key}`} value={entry} {disabled} onchange={(next) => update({ ...value as Record<string, unknown>, [key]: next })} /></div>
 {/each}
 </div>
{:else if (typeof value === 'string' || typeof value === 'number') && allowed?.length}
 <select {id} class={inputClass} value={String(value)} {disabled} onchange={(event) => update(typeof value === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value)}>
  {#if !allowed.some((option) => option === value)}<option value={String(value)}>{allowedLabels?.[String(value)] ?? value} (current)</option>{/if}
  {#each allowed as option (option)}<option value={String(option)}>{allowedLabels?.[String(option)] ?? option}</option>{/each}
 </select>
{:else}
 <input {id} class={inputClass} type={typeof value === 'number' ? 'number' : 'text'} required={typeof value === 'number'} step={typeof value === 'number' ? type === 'int-setting' ? '1' : 'any' : undefined} min={typeof value === 'number' ? min : undefined} max={typeof value === 'number' ? max : undefined} {disabled} value={String(value ?? '')} oninput={(event) => update(typeof value === 'number' ? event.currentTarget.valueAsNumber : event.currentTarget.value)} />
{/if}
