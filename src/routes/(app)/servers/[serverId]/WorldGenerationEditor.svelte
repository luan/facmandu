<script lang="ts">
 import { CheckIcon, ImageIcon, LoaderCircleIcon, RefreshCwIcon } from '@lucide/svelte';
 import { enhance } from '$app/forms';
 import type { SubmitFunction } from '@sveltejs/kit';
 import { onDestroy } from 'svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import PrototypeIcon from '$lib/components/PrototypeIcon.svelte';
 import FactorioRichText from '$lib/components/FactorioRichText.svelte';
 import SettingHelp from './SettingHelp.svelte';
 import ResourceMultiplier from './ResourceMultiplier.svelte';
 import { worldGenerationSchema, type WorldGenerationSettings } from '$lib/map-generation';

 type Resource = { name: string; label: string; description?: string; order?: string; category: string; richness: boolean; canBeDisabled: boolean };
 type Preset = { name: string; label: string; description?: string; order?: string; defaults?: WorldGenerationSettings };
 type Catalog = { presets: Preset[]; resources: Resource[]; controls?: Resource[]; supportsNoEnemies?: boolean; previewAvailable: boolean; previewReason?: string };
 type ResourceControl = NonNullable<WorldGenerationSettings['resources']>[string];
 let { serverId, action, submit, createReason, name = $bindable(''), settings = $bindable<WorldGenerationSettings>() }: {
  serverId: string; action: string; submit: SubmitFunction; createReason: string;
  name: string; settings: WorldGenerationSettings;
 } = $props();
 let catalog = $state<Catalog | null>(null);
 let catalogError = $state('');
 let catalogLoading = $state(true);
 let previewUrl = $state('');
 let previewError = $state('');
 let previewLoading = $state(false);
 let previewSignature = $state('');
 let previewController: AbortController | null = null;
 const signature = $derived(JSON.stringify(settings));
 const presetDefaults = $derived(catalog?.presets.find((preset) => preset.name === settings.preset)?.defaults);
 const validation = $derived(worldGenerationSchema.safeParse({
  ...settings,
  ...(settings.expansion && { expansion: { ...presetDefaults?.expansion, ...settings.expansion } })
 }));
 const settingsError = $derived.by(() => {
  if (validation.success) return '';
  const issue = validation.error.issues[0];
  if (!issue) return 'Invalid map setting';
  const [section, name, field] = issue.path.map(String);
  const readable = (value: string) => value.replaceAll(/([a-z])([A-Z])/gu, '$1 $2').replaceAll(/[-_]/gu, ' ').toLowerCase();
  const label = section === 'resources' && name
   ? `${catalog?.controls?.find((control) => control.name === name)?.label ?? catalog?.resources.find((resource) => resource.name === name)?.label ?? readable(name)}${field ? ` ${readable(field)}` : ''}`
   : issue.path.map((part) => readable(String(part))).join(' ');
  return `${label ? `${label}: ` : ''}${issue.message}`;
 });
 const stale = $derived(!!previewUrl && previewSignature !== signature);
 const baseUrl = $derived(`/api/servers/${encodeURIComponent(serverId)}/map-generation`);
 const multiplierChoices = [0, 0.17, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 10];
 const displayMultiplier = (value: number) => value === 0 ? 'None' : `${value}×`;
 const resourceValue = (resource: string, field: keyof ResourceControl) => settings.resources?.[resource]?.[field];
 const enemyBase = $derived(catalog?.controls?.find((control) => control.name === 'enemy-base') ?? catalog?.resources.find((resource) => resource.name === 'enemy-base'));
 const presetNumber = (value: number | undefined) => value === undefined ? 'Preset default' : `Preset ${value}`;
 const presetMultiplier = (value: number | undefined) => value === undefined ? 'Preset default' : `Preset ${value}×`;
 const presetToggle = (value: boolean | undefined) => value === undefined ? 'Preset default' : `Preset (${value ? 'On' : 'Off'})`;
 function setResource(resource: string, field: keyof ResourceControl, value: number | undefined) {
  const control = { ...settings.resources?.[resource] };
  if (value === undefined) delete control[field]; else control[field] = value;
  const resources = { ...settings.resources };
  if (Object.keys(control).length) resources[resource] = control; else delete resources[resource];
  settings = { ...settings, resources: Object.keys(resources).length ? resources : undefined };
 }
 function setEvolution(field: keyof NonNullable<WorldGenerationSettings['evolution']>, value: string) {
  const evolution = { ...settings.evolution };
  if (value === '') delete evolution[field];
  else if (field === 'enabled') evolution.enabled = value === 'true';
  else evolution[field] = Number(value);
  settings = { ...settings, evolution: Object.keys(evolution).length ? evolution : undefined };
 }
 function setTerrain(field: keyof NonNullable<WorldGenerationSettings['terrain']>, value: string) {
  const terrain = { ...settings.terrain };
  if (value === '') delete terrain[field];
  else if (field === 'mapType') terrain.mapType = value as 'normal' | 'island';
  else terrain[field] = Number(value) as never;
  settings = { ...settings, terrain: Object.keys(terrain).length ? terrain : undefined };
 }
 function setNumber(field: 'startingArea' | 'width' | 'height', value: string) {
  settings = { ...settings, [field]: value === '' ? undefined : Number(value) };
 }
 function setBoolean(field: 'peacefulMode' | 'noEnemiesMode', value: string) {
  settings = { ...settings, [field]: value === '' ? undefined : value === 'true' };
 }
 function setPollution(field: keyof NonNullable<WorldGenerationSettings['pollution']>, value: string) {
  const pollution = { ...settings.pollution };
  if (value === '') delete pollution[field];
  else if (field === 'enabled') pollution.enabled = value === 'true';
  else pollution[field] = Number(value) as never;
  settings = { ...settings, pollution: Object.keys(pollution).length ? pollution : undefined };
 }
 function setExpansion(field: keyof NonNullable<WorldGenerationSettings['expansion']>, value: string) {
  const expansion = { ...settings.expansion };
  if (value === '') delete expansion[field];
  else if (field === 'enabled') expansion.enabled = value === 'true';
  else expansion[field] = Number(value) as never;
  settings = { ...settings, expansion: Object.keys(expansion).length ? expansion : undefined };
 }
 function changePreset(value: string) {
  // Preset changes discard overrides from the previous preset; the seed keeps the preview and save aligned.
  settings = { preset: value, seed: settings.seed };
 }
 function newSeed() {
  settings = { ...settings, seed: crypto.getRandomValues(new Uint32Array(1))[0] };
 }
 async function refreshPreview() {
  if (previewLoading || !catalog?.previewAvailable || settings.seed === undefined || !validation.success) return;
  previewController?.abort();
  const controller = new AbortController();
  previewController = controller;
  const requested = signature;
  previewLoading = true;
  previewError = '';
  try {
   const response = await fetch(`${baseUrl}/preview`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ settings }), signal: controller.signal
   });
   if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.message === 'string' ? body.message : 'Could not generate map preview');
   }
   const nextUrl = URL.createObjectURL(await response.blob());
   if (controller.signal.aborted) { URL.revokeObjectURL(nextUrl); return; }
   if (previewUrl) URL.revokeObjectURL(previewUrl);
   previewUrl = nextUrl;
   previewSignature = requested;
  } catch (cause) {
   if (!controller.signal.aborted) previewError = cause instanceof Error ? cause.message : 'Could not generate map preview';
  } finally {
   if (previewController === controller) { previewController = null; previewLoading = false; }
  }
 }
 $effect(() => {
  const controller = new AbortController();
  void (async () => {
   try {
    const response = await fetch(baseUrl, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) {
     const body = await response.json().catch(() => ({}));
     throw new Error(typeof body.message === 'string' ? body.message : 'Could not load world generation options');
    }
    const result: Catalog = await response.json();
    if (!controller.signal.aborted) catalog = result;
   } catch (cause) {
    if (!controller.signal.aborted) catalogError = cause instanceof Error ? cause.message : 'Could not load world generation options';
   } finally { if (!controller.signal.aborted) catalogLoading = false; }
  })();
  return () => {
   controller.abort();
  };
 });
 onDestroy(() => { previewController?.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
</script>

<form method="POST" {action} use:enhance={submit} class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
 <input type="hidden" name="operation" value="createSave" />
 <input type="hidden" name="name" value={name.trim().endsWith('.zip') ? name.trim() : `${name.trim()}.zip`} />
 <input type="hidden" name="worldGeneration" value={signature} />
 <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region needs focus for keyboard scrolling.) -->
 <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region must support keyboard scrolling. -->
 <section aria-label="World generation settings" tabindex="0" class="world-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
 <div class="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
  <div class="world-settings min-w-0 space-y-5">
   <section class="space-y-3">
    <h3 class="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">World</h3>
    <label class="block space-y-1 text-sm"><span>Save name</span><input bind:value={name} required class="w-full border border-border bg-background px-3 py-2" placeholder="New world" /></label>
    <div class="grid items-end gap-3 sm:grid-cols-2">
     <label class="block space-y-1 text-sm"><span>Preset</span><select value={settings.preset ?? 'default'} onchange={(event) => changePreset(event.currentTarget.value)} disabled={!catalog} class="w-full border border-border bg-background px-3 py-2"><option value="default">Default</option>{#each catalog?.presets.filter((preset) => preset.name !== 'default') ?? [] as preset (preset.name)}<option value={preset.name}>{preset.label}</option>{/each}</select></label>
     <div class="space-y-1 text-sm"><label class="field-label" for="world-seed">Seed</label><div class="flex gap-1"><input id="world-seed" type="number" min="0" max="4294967295" required value={settings.seed ?? ''} oninput={(event) => settings = { ...settings, seed: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) }} class="min-w-0 w-full border border-border bg-background px-3 py-2 tabular-nums" /><TooltipButton type="button" variant="outline" size="icon" tooltip="Random seed" aria-label="Random seed" class="size-9 shrink-0" onclick={newSeed}><RefreshCwIcon class="size-4" /></TooltipButton></div></div>
    </div>
    {#if catalog?.presets.find((preset) => preset.name === settings.preset)?.description}<p class="text-xs text-muted-foreground">{catalog.presets.find((preset) => preset.name === settings.preset)?.description}</p>{/if}
   </section>
   <section class="space-y-3">
    <h3 class="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">Map</h3>
    <div class="grid items-end gap-3 sm:grid-cols-2">
     <label class="block space-y-1 text-sm"><span>Width</span><input type="number" min="0" max="2000000" step="1" value={settings.width ?? ''} placeholder={presetDefaults?.width ? `Preset ${presetDefaults.width}` : 'Unlimited'} oninput={(event) => setNumber('width', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2 tabular-nums" /></label>
     <label class="block space-y-1 text-sm"><span>Height</span><input type="number" min="0" max="2000000" step="1" value={settings.height ?? ''} placeholder={presetDefaults?.height ? `Preset ${presetDefaults.height}` : 'Unlimited'} oninput={(event) => setNumber('height', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2 tabular-nums" /></label>
     <div class="space-y-1 text-sm"><div class="field-label flex items-center gap-1"><label for="world-starting-area">Starting area</label><SettingHelp label="Starting area" description="Size of the starting area without enemy bases." {serverId} /></div><select id="world-starting-area" value={settings.startingArea ?? ''} onchange={(event) => setNumber('startingArea', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2"><option value="">{presetMultiplier(presetDefaults?.startingArea)}</option>{#each multiplierChoices.filter((value) => value > 0) as value}<option value={value}>{displayMultiplier(value)}</option>{/each}</select></div>
     <label class="block space-y-1 text-sm"><span>Map type</span><select value={settings.terrain?.mapType ?? ''} onchange={(event) => setTerrain('mapType', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2"><option value="">{presetDefaults?.terrain?.mapType === undefined ? 'Preset default' : `Preset (${presetDefaults.terrain.mapType})`}</option><option value="normal">Normal</option><option value="island">Island</option></select></label>
    </div>
   </section>
   <details open class="space-y-3">
    <summary class="cursor-pointer border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">Resources</summary>
    {#if catalogLoading}<p class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon class="size-4 animate-spin" />Loading installed resources…</p>
    {:else if catalogError}<p role="alert" class="text-sm text-destructive">{catalogError}</p>
    {:else if !catalog?.resources.some((resource) => resource.name !== 'enemy-base')}<p class="text-sm text-muted-foreground">No configurable resources found.</p>
    {:else}<div class="space-y-3">{#each catalog.resources.filter((resource) => resource.name !== 'enemy-base') as resource (resource.name)}
     <div class="border border-border/70 bg-background/40 p-3">
      <div class="mb-2 flex items-center gap-2"><PrototypeIcon prototype={{ kind: 'entity', name: resource.name }} {serverId} /><span class="min-w-0 flex-1 text-sm font-medium"><FactorioRichText text={resource.label} {serverId} /></span>{#if resource.description}<SettingHelp label={resource.label} description={resource.description} {serverId} />{/if}</div>
      <div class="resource-controls"><ResourceMultiplier context={resource.label} label="Frequency" value={resourceValue(resource.name, 'frequency')} defaultValue={presetDefaults?.resources?.[resource.name]?.frequency} allowZero={resource.canBeDisabled} onChange={(value) => setResource(resource.name, 'frequency', value)} /><ResourceMultiplier context={resource.label} label="Size" value={resourceValue(resource.name, 'size')} defaultValue={presetDefaults?.resources?.[resource.name]?.size} allowZero={resource.canBeDisabled} onChange={(value) => setResource(resource.name, 'size', value)} />{#if resource.richness}<ResourceMultiplier context={resource.label} label="Richness" value={resourceValue(resource.name, 'richness')} defaultValue={presetDefaults?.resources?.[resource.name]?.richness} allowZero={resource.canBeDisabled} onChange={(value) => setResource(resource.name, 'richness', value)} />{/if}</div>
     </div>
    {/each}</div>{/if}
   </details>
   <section class="space-y-3">
    <h3 class="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">Enemies & evolution</h3>
    <div class="grid items-end gap-3 sm:grid-cols-2">
     <label class="block space-y-1 text-sm"><span>Peaceful mode</span><select value={settings.peacefulMode === undefined ? '' : String(settings.peacefulMode)} onchange={(event) => setBoolean('peacefulMode', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2"><option value="">{presetToggle(presetDefaults?.peacefulMode)}</option><option value="true">On</option><option value="false">Off</option></select></label>
     {#if catalog?.supportsNoEnemies}<label class="block space-y-1 text-sm"><span>Enemy bases</span><select value={settings.noEnemiesMode === undefined ? '' : String(settings.noEnemiesMode)} onchange={(event) => setBoolean('noEnemiesMode', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2"><option value="">{presetToggle(presetDefaults?.noEnemiesMode === undefined ? undefined : !presetDefaults.noEnemiesMode)}</option><option value="false">On</option><option value="true">Off</option></select></label>{/if}
     <label class="block space-y-1 text-sm"><span>Evolution</span><select value={settings.evolution?.enabled === undefined ? '' : String(settings.evolution.enabled)} onchange={(event) => setEvolution('enabled', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2"><option value="">{presetToggle(presetDefaults?.evolution?.enabled)}</option><option value="true">On</option><option value="false">Off</option></select></label>
    </div>
    <div class="grid items-end gap-3 sm:grid-cols-3">{#each ([['timeFactor', 'Time', 'Evolution from elapsed time.'], ['destroyFactor', 'Kills', 'Evolution from destroyed enemy spawners.'], ['pollutionFactor', 'Pollution', 'Evolution from produced pollution.']] as const) as [field, label, description]}<div class="space-y-1 text-xs"><div class="field-label flex items-center gap-1"><label for={`evolution-${field}`}>{label} factor</label><SettingHelp {label} {description} {serverId} /></div><input id={`evolution-${field}`} type="number" min="0" max="1" step="any" value={settings.evolution?.[field] ?? ''} placeholder={presetNumber(presetDefaults?.evolution?.[field])} oninput={(event) => setEvolution(field, event.currentTarget.value)} class="w-full border border-border bg-background px-2 py-2 tabular-nums" /></div>{/each}</div>
    {#if enemyBase}
     {@const enemy = enemyBase}
     <div class="border border-border/70 bg-background/40 p-3"><div class="mb-2 flex items-center gap-1 text-sm font-medium">Enemy bases {#if enemy.description}<SettingHelp label="Enemy bases" description={enemy.description} {serverId} />{/if}</div><div class="grid grid-cols-1 gap-3 sm:grid-cols-2"><ResourceMultiplier context="Enemy bases" label="Frequency" value={resourceValue('enemy-base', 'frequency')} defaultValue={presetDefaults?.resources?.['enemy-base']?.frequency} allowZero={enemy.canBeDisabled} onChange={(value) => setResource('enemy-base', 'frequency', value)} /><ResourceMultiplier context="Enemy bases" label="Size" value={resourceValue('enemy-base', 'size')} defaultValue={presetDefaults?.resources?.['enemy-base']?.size} allowZero={enemy.canBeDisabled} onChange={(value) => setResource('enemy-base', 'size', value)} /></div></div>
    {/if}
   </section>
   <details class="space-y-3">
    <summary class="cursor-pointer border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">Terrain</summary>
    <div class="grid items-end gap-3 pt-3 sm:grid-cols-2">{#each ([['waterScale', 'Water scale', 0.01, 10], ['waterCoverage', 'Water coverage', 0, 10], ['treeScale', 'Tree scale', 0.01, 10], ['treeCoverage', 'Tree coverage', 0, 10], ['cliffFrequency', 'Cliff frequency', 0, 10], ['cliffContinuity', 'Cliff continuity', 0, 10], ['moistureScale', 'Moisture scale', 0.01, 10], ['moistureBias', 'Moisture bias', -1, 1], ['terrainScale', 'Terrain scale', 0.01, 10], ['terrainBias', 'Terrain bias', -1, 1]] as const) as [field, label, min, max]}<label class="block space-y-1 text-xs"><span>{label}</span><input type="number" {min} {max} step="any" value={settings.terrain?.[field] ?? ''} placeholder={presetNumber(presetDefaults?.terrain?.[field])} oninput={(event) => setTerrain(field, event.currentTarget.value)} class="w-full border border-border bg-background px-2 py-2 tabular-nums" /></label>{/each}</div>
   </details>
   <details class="space-y-3">
    <summary class="cursor-pointer border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">Pollution</summary>
    <div class="grid items-end gap-3 pt-3 sm:grid-cols-2">
     <label class="block space-y-1 text-sm"><span>Pollution</span><select value={settings.pollution?.enabled === undefined ? '' : String(settings.pollution.enabled)} onchange={(event) => setPollution('enabled', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2"><option value="">{presetToggle(presetDefaults?.pollution?.enabled)}</option><option value="true">On</option><option value="false">Off</option></select></label>
     {#each ([['diffusionRatio', 'Diffusion ratio', 0, 1], ['ageing', 'Absorption rate', 0, 10], ['enemyAttackPollutionConsumptionModifier', 'Enemy attack cost', 0, 10], ['minPollutionToDamageTrees', 'Tree damage threshold', 0, 1000000], ['pollutionRestoredPerTreeDamage', 'Pollution per tree damage', 0, 1000000]] as const) as [field, label, min, max]}<label class="block space-y-1 text-xs"><span>{label}</span><input type="number" {min} {max} step="any" value={settings.pollution?.[field] ?? ''} placeholder={presetNumber(presetDefaults?.pollution?.[field])} oninput={(event) => setPollution(field, event.currentTarget.value)} class="w-full border border-border bg-background px-2 py-2 tabular-nums" /></label>{/each}
    </div>
   </details>
   <details class="space-y-3">
    <summary class="cursor-pointer border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">Enemy expansion</summary>
    <div class="grid items-end gap-3 pt-3 sm:grid-cols-2">
     <label class="block space-y-1 text-sm"><span>Expansion</span><select value={settings.expansion?.enabled === undefined ? '' : String(settings.expansion.enabled)} onchange={(event) => setExpansion('enabled', event.currentTarget.value)} class="w-full border border-border bg-background px-3 py-2"><option value="">{presetToggle(presetDefaults?.expansion?.enabled)}</option><option value="true">On</option><option value="false">Off</option></select></label>
     {#each ([['minCooldown', 'Minimum cooldown'], ['maxCooldown', 'Maximum cooldown']] as const) as [field, label]}<label class="block space-y-1 text-xs"><span>{label} (minutes)</span><input type="number" min="0" max="1193046" step="any" value={settings.expansion?.[field] === undefined ? '' : settings.expansion[field] / 3600} placeholder={presetNumber(presetDefaults?.expansion?.[field] === undefined ? undefined : presetDefaults.expansion[field] / 3600)} oninput={(event) => setExpansion(field, event.currentTarget.value === '' ? '' : String(Math.round(Number(event.currentTarget.value) * 3600)))} class="w-full border border-border bg-background px-2 py-2 tabular-nums" /></label>{/each}
     {#each ([['maxDistance', 'Maximum distance'], ['minGroupSize', 'Minimum group size'], ['maxGroupSize', 'Maximum group size']] as const) as [field, label]}<label class="block space-y-1 text-xs"><span>{label}</span><input type="number" min="0" max="4294967295" step="1" value={settings.expansion?.[field] ?? ''} placeholder={presetNumber(presetDefaults?.expansion?.[field])} oninput={(event) => setExpansion(field, event.currentTarget.value)} class="w-full border border-border bg-background px-2 py-2 tabular-nums" /></label>{/each}
    </div>
   </details>
   <details class="space-y-3">
    <summary class="cursor-pointer border-b border-border pb-1 text-xs font-semibold uppercase tracking-wider text-primary">Research</summary>
    <label class="block space-y-1 pt-3 text-xs"><span>Technology price multiplier</span><input type="number" min="0.01" max="1000" step="any" value={settings.research?.technologyPriceMultiplier ?? ''} placeholder={presetNumber(presetDefaults?.research?.technologyPriceMultiplier)} oninput={(event) => settings = { ...settings, research: event.currentTarget.value === '' ? undefined : { technologyPriceMultiplier: Number(event.currentTarget.value) } }} class="w-full border border-border bg-background px-2 py-2 tabular-nums" /></label>
   </details>
  </div>
  <aside class="min-w-0 lg:sticky lg:top-0 lg:self-start">
   <div class="space-y-3">
    <div class="preview-heading flex items-center justify-between gap-2 border-b border-border"><h3 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><ImageIcon class="size-4 text-primary" />Map preview</h3>{#if stale}<span class="text-xs text-amber-400">Settings changed</span>{/if}</div>
    <div class="relative flex aspect-square items-center justify-center overflow-hidden border border-border bg-[#10120e]">
     {#if previewUrl}<img src={previewUrl} alt="Generated map preview" class={`h-full w-full object-contain ${stale ? 'opacity-45' : ''}`} />{:else}<p class="px-4 text-center text-xs text-muted-foreground">Generate a preview to see this map.</p>{/if}
     {#if previewLoading}<div class="absolute inset-0 flex items-center justify-center gap-2 bg-background/75 text-sm"><LoaderCircleIcon class="size-5 animate-spin" />Generating preview…</div>{/if}
    </div>
    {#if previewError}<p role="alert" class="mt-2 text-xs text-destructive">{previewError}</p>{/if}
    {#if catalog && !catalog.previewAvailable}<p class="mt-2 text-xs text-muted-foreground">{catalog.previewReason ?? 'Preview is unavailable.'}</p>{/if}
    {#if settingsError}<p role="alert" class="mt-2 text-xs text-destructive">{settingsError}</p>{/if}
    <TooltipButton type="button" variant="outline" size="sm" tooltip={catalog?.previewReason || settingsError || 'Generate map preview'} disabled={!catalog?.previewAvailable || previewLoading || settings.seed === undefined || !validation.success} onclick={refreshPreview} class="w-full"><RefreshCwIcon class="size-4" />{previewUrl ? 'Regenerate preview' : 'Generate preview'}</TooltipButton>
   </div>
  </aside>
 </div>
 </section>
 <div class="world-footer flex shrink-0 justify-end border-t border-border bg-background px-4 py-3 sm:px-6"><TooltipButton tooltip={createReason || settingsError || 'Create save'} type="submit" disabled={!!createReason || !name.trim() || settings.seed === undefined || !validation.success || catalogLoading || !!catalogError}><CheckIcon class="size-4" />Create save</TooltipButton></div>
</form>

<style>
 .world-settings { container-type: inline-size; }
 .resource-controls { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
 @container (min-width: 40rem) {
  .resource-controls { grid-template-columns: repeat(3, minmax(0, 1fr)); }
 }

 /* Keep help buttons from changing label baselines or the following control row. */
 .world-body label > span:first-child, .field-label {
  display: flex;
  min-height: 24px;
  align-items: center;
 }
 .world-body input:not([type="range"]):not([type="hidden"]), .world-body select {
  height: 36px;
  min-width: 0;
  padding: 0 10px;
  font-size: 14px;
 }
 .world-body h3, .world-body summary, .preview-heading {
  min-height: 24px;
 }
 .world-body h3 { display: flex; align-items: center; padding-bottom: 0; }
 .preview-heading { height: 24px; }
 .preview-heading h3 { min-height: 0; }
 .world-body summary { list-style-position: inside; }
</style>
